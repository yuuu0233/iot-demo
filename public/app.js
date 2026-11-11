const HISTORY_LIMIT = 60

const state = {
    connected: false,
    running: false,
    config: { intervalMs: 3000, min: 25, max: 30 },
    latest: null,
    history: [],
    logs: [],
    stats: { count: 0, avg: null, min: null, max: null },
}

const els = {
    topic: document.getElementById('topic'),
    broker: document.getElementById('broker'),
    connBadge: document.getElementById('connBadge'),
    connText: document.getElementById('connText'),
    runBadge: document.getElementById('runBadge'),
    runText: document.getElementById('runText'),
    toggleBtn: document.getElementById('toggleBtn'),
    temp: document.getElementById('temp'),
    updatedAt: document.getElementById('updatedAt'),
    statCount: document.getElementById('statCount'),
    statAvg: document.getElementById('statAvg'),
    statMin: document.getElementById('statMin'),
    statMax: document.getElementById('statMax'),
    form: document.getElementById('configForm'),
    intervalInput: document.getElementById('intervalInput'),
    minInput: document.getElementById('minInput'),
    maxInput: document.getElementById('maxInput'),
    formHint: document.getElementById('formHint'),
    logs: document.getElementById('logs'),
    chart: document.getElementById('chart'),
}

function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatTemp(value) {
    return value === null || value === undefined ? '--' : `${Number(value).toFixed(2)} ℃`
}

function setHint(text, type) {
    els.formHint.textContent = text || ''
    els.formHint.className = `hint${type ? ` ${type}` : ''}`
}

/* ---------- 渲染 ---------- */

function renderStatus() {
    els.connBadge.className = `badge ${state.connected ? 'on' : 'off'}`
    els.connText.textContent = state.connected ? '已连接' : '未连接'

    els.runBadge.className = `badge ${state.running ? 'running' : 'off'}`
    els.runText.textContent = state.running ? '发布中' : '已暂停'

    els.toggleBtn.textContent = state.running ? '暂停发布' : '开始发布'
    els.toggleBtn.classList.toggle('pause', state.running)
}

function renderStats() {
    const { count, avg, min, max } = state.stats
    els.statCount.textContent = String(count ?? 0)
    els.statAvg.textContent = formatTemp(avg)
    els.statMin.textContent = formatTemp(min)
    els.statMax.textContent = formatTemp(max)
}

function renderCurrent() {
    const latest = state.latest
    els.temp.textContent = latest ? latest.temperature.toFixed(2) : '--.--'
    els.updatedAt.textContent = latest ? `更新于 ${formatTime(latest.ts)}` : '等待数据…'
}

function renderConfig() {
    const form = els.form
    if (form.contains(document.activeElement)) return
    const { intervalMs, min, max } = state.config
    els.intervalInput.value = intervalMs
    els.minInput.value = min
    els.maxInput.value = max
}

function appendLog(entry) {
    const empty = els.logs.querySelector('.empty')
    if (empty) empty.remove()

    const li = document.createElement('li')
    li.className = entry.level || 'info'

    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = formatTime(entry.ts)

    const message = document.createElement('span')
    message.textContent = entry.message

    li.append(time, message)
    els.logs.appendChild(li)

    while (els.logs.children.length > 50) {
        els.logs.removeChild(els.logs.firstElementChild)
    }
    els.logs.scrollTop = els.logs.scrollHeight
}

function renderLogs() {
    els.logs.innerHTML = ''
    if (!state.logs.length) {
        const li = document.createElement('li')
        li.className = 'empty'
        li.textContent = '暂无日志'
        els.logs.appendChild(li)
        return
    }
    state.logs.forEach(appendLog)
}

/* ---------- 图表 ---------- */

function drawChart() {
    const canvas = els.chart
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)

    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const pad = { top: 18, right: 20, bottom: 28, left: 52 }
    const plotW = rect.width - pad.left - pad.right
    const plotH = rect.height - pad.top - pad.bottom
    if (plotW <= 0 || plotH <= 0) return

    const points = state.history
    if (!points.length) {
        ctx.fillStyle = 'rgba(139, 155, 180, 0.7)'
        ctx.font = '13px "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('暂无数据，点击「开始发布」后展示温度曲线', rect.width / 2, rect.height / 2)
        return
    }

    let minVal = Math.min(...points.map((p) => p.temperature))
    let maxVal = Math.max(...points.map((p) => p.temperature))
    if (minVal === maxVal) {
        minVal -= 1
        maxVal += 1
    }
    const spread = maxVal - minVal
    minVal -= spread * 0.15
    maxVal += spread * 0.15

    ctx.font = '11px Consolas, monospace'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)'
    ctx.fillStyle = 'rgba(139, 155, 180, 0.85)'
    ctx.lineWidth = 1

    const gridRows = 4
    for (let i = 0; i <= gridRows; i += 1) {
        const y = pad.top + (plotH * i) / gridRows
        ctx.beginPath()
        ctx.moveTo(pad.left, y)
        ctx.lineTo(pad.left + plotW, y)
        ctx.stroke()

        const value = maxVal - ((maxVal - minVal) * i) / gridRows
        ctx.textAlign = 'right'
        ctx.fillText(`${value.toFixed(1)}℃`, pad.left - 10, y)
    }

    const xAt = (index) =>
        points.length === 1
            ? pad.left + plotW / 2
            : pad.left + (plotW * index) / (points.length - 1)
    const yAt = (value) => pad.top + plotH * (1 - (value - minVal) / (maxVal - minVal))

    const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.temperature) }))

    const tracePath = () => {
        ctx.beginPath()
        ctx.moveTo(coords[0].x, coords[0].y)
        for (let i = 0; i < coords.length - 1; i += 1) {
            const current = coords[i]
            const next = coords[i + 1]
            const midX = (current.x + next.x) / 2
            const midY = (current.y + next.y) / 2
            ctx.quadraticCurveTo(current.x, current.y, midX, midY)
        }
        const last = coords[coords.length - 1]
        ctx.lineTo(last.x, last.y)
    }

    // 渐变填充
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(coords[0].x, coords[0].y)
    for (let i = 0; i < coords.length - 1; i += 1) {
        const current = coords[i]
        const next = coords[i + 1]
        ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2)
    }
    const last = coords[coords.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.lineTo(last.x, pad.top + plotH)
    ctx.lineTo(coords[0].x, pad.top + plotH)
    ctx.closePath()

    const fill = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH)
    fill.addColorStop(0, 'rgba(34, 211, 238, 0.32)')
    fill.addColorStop(1, 'rgba(34, 211, 238, 0)')
    ctx.fillStyle = fill
    ctx.fill()
    ctx.restore()

    // 折线
    ctx.save()
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2.2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(34, 211, 238, 0.55)'
    ctx.shadowBlur = 12
    tracePath()
    ctx.stroke()
    ctx.restore()

    // 最新点
    const lastPoint = coords[coords.length - 1]
    ctx.save()
    ctx.beginPath()
    ctx.arc(lastPoint.x, lastPoint.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#22d3ee'
    ctx.shadowColor = 'rgba(34, 211, 238, 0.9)'
    ctx.shadowBlur = 16
    ctx.fill()
    ctx.beginPath()
    ctx.arc(lastPoint.x, lastPoint.y, 9, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()

    // 时间轴
    ctx.fillStyle = 'rgba(139, 155, 180, 0.85)'
    ctx.textBaseline = 'top'
    const ticks = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0]
    ticks.forEach((index, i) => {
        ctx.textAlign = i === 0 ? 'left' : i === ticks.length - 1 ? 'right' : 'center'
        const x = points.length === 1 ? pad.left : xAt(index)
        ctx.fillText(formatTime(points[index].ts), x, pad.top + plotH + 8)
    })
}

/* ---------- 数据接入 ---------- */

function hydrate(data) {
    state.connected = Boolean(data.connected)
    state.running = Boolean(data.running)
    if (data.config) state.config = data.config
    if (data.url) els.broker.textContent = data.url
    if (data.topic) els.topic.textContent = data.topic
    state.latest = data.latest || null
    state.history = Array.isArray(data.history) ? data.history.slice(-HISTORY_LIMIT) : []
    state.logs = Array.isArray(data.logs) ? data.logs : []
    if (data.stats) state.stats = data.stats

    renderStatus()
    renderConfig()
    renderCurrent()
    renderStats()
    renderLogs()
    drawChart()
}

function pushLocalLog(level, message) {
    appendLog({ level, message, ts: Date.now() })
}

async function postJson(url) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || `请求失败（${res.status}）`)
    return data
}

els.toggleBtn.addEventListener('click', async () => {
    els.toggleBtn.disabled = true
    try {
        const data = await postJson(state.running ? '/api/stop' : '/api/start')
        state.connected = Boolean(data.connected)
        state.running = Boolean(data.running)
        renderStatus()
    } catch (err) {
        pushLocalLog('error', err.message)
    } finally {
        els.toggleBtn.disabled = false
    }
})

els.form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const payload = {
        intervalMs: Number(els.intervalInput.value),
        min: Number(els.minInput.value),
        max: Number(els.maxInput.value),
    }
    try {
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            setHint(data.message || '配置保存失败', 'error')
            return
        }
        state.config = data.config
        renderConfig()
        setHint('配置已生效', 'ok')
    } catch (err) {
        setHint(err.message, 'error')
    }
})

function connectStream() {
    const source = new EventSource('/api/stream')

    source.addEventListener('state', (event) => hydrate(JSON.parse(event.data)))

    source.addEventListener('reading', (event) => {
        const reading = JSON.parse(event.data)
        state.latest = reading
        state.history.push(reading)
        if (state.history.length > HISTORY_LIMIT) state.history.shift()
        renderCurrent()
        drawChart()
    })

    source.addEventListener('stats', (event) => {
        state.stats = JSON.parse(event.data)
        renderStats()
    })

    source.addEventListener('log', (event) => appendLog(JSON.parse(event.data)))

    source.addEventListener('status', (event) => {
        const status = JSON.parse(event.data)
        state.connected = Boolean(status.connected)
        state.running = Boolean(status.running)
        if (status.config) state.config = status.config
        renderStatus()
        renderConfig()
    })

    source.addEventListener('config', (event) => {
        state.config = JSON.parse(event.data)
        renderConfig()
    })

    source.onerror = () => {
        els.connText.textContent = '重连中…'
        els.connBadge.className = 'badge off'
    }
}

window.addEventListener('resize', drawChart)

renderStatus()
renderConfig()
renderCurrent()
renderStats()
drawChart()
connectStream()
