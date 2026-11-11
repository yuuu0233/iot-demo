require('dotenv').config({ quiet: true })

const path = require('path')
const express = require('express')
const { createPublisher } = require('./publisher')

const PORT = Number(process.env.PORT) || 3000
const HISTORY_LIMIT = 60
const LOG_LIMIT = 50

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const publisher = createPublisher()
const state = {
    latest: null,
    history: [],
    logs: [],
    stats: { count: 0, sum: 0, min: null, max: null },
}
const clients = new Set()

function snapshot() {
    return {
        ...publisher.status(),
        latest: state.latest,
        history: state.history,
        logs: state.logs,
        stats: {
            count: state.stats.count,
            avg: state.stats.count ? Number((state.stats.sum / state.stats.count).toFixed(2)) : null,
            min: state.stats.min,
            max: state.stats.max,
        },
    }
}

function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function broadcast(event, data) {
    for (const res of clients) {
        send(res, event, data)
    }
}

publisher.on('published', (reading) => {
    state.latest = reading
    state.history.push(reading)
    if (state.history.length > HISTORY_LIMIT) state.history.shift()

    state.stats.count += 1
    state.stats.sum += reading.temperature
    state.stats.min = state.stats.min === null ? reading.temperature : Math.min(state.stats.min, reading.temperature)
    state.stats.max = state.stats.max === null ? reading.temperature : Math.max(state.stats.max, reading.temperature)

    broadcast('reading', reading)
    broadcast('stats', snapshot().stats)
})

publisher.on('log', (entry) => {
    state.logs.push(entry)
    if (state.logs.length > LOG_LIMIT) state.logs.shift()
    broadcast('log', entry)
})

publisher.on('status', (status) => {
    broadcast('status', status)
})

publisher.on('config', (config) => {
    broadcast('config', config)
})

publisher.on('error', () => {
    // 错误已经通过 log 事件记录并推送到页面
})

app.get('/api/state', (req, res) => {
    res.json(snapshot())
})

app.get('/api/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    })
    res.flushHeaders()
    send(res, 'state', snapshot())

    clients.add(res)
    req.on('close', () => {
        clients.delete(res)
    })
})

app.post('/api/start', (req, res) => {
    if (!publisher.connected) {
        res.status(503).json({ ok: false, message: 'Broker 未连接，暂时无法发布' })
        return
    }
    publisher.start()
    res.json({ ok: true, ...snapshot() })
})

app.post('/api/stop', (req, res) => {
    publisher.stop()
    res.json({ ok: true, ...snapshot() })
})

app.post('/api/config', (req, res) => {
    const { intervalMs, min, max } = req.body || {}
    try {
        const config = publisher.updateConfig({
            intervalMs: Number(intervalMs),
            min: Number(min),
            max: Number(max),
        })
        res.json({ ok: true, config })
    } catch (err) {
        res.status(400).json({ ok: false, message: err.message })
    }
})

const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n')
}, 25000)
heartbeat.unref()

const server = app.listen(PORT, () => {
    console.log(`🌐 可视化看板已启动：http://localhost:${PORT}`)
    console.log(`📡 Broker: ${publisher.url}  主题: ${publisher.topic}`)
    publisher.connect()
})

server.on('error', (err) => {
    console.error('❌ 服务启动失败：', err.message)
    process.exit(1)
})

function shutdown() {
    clearInterval(heartbeat)
    publisher.close()
    server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
