const EventEmitter = require('events')
const mqtt = require('mqtt')
require('dotenv').config({ quiet: true })

const DEFAULT_URL = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883'
const DEFAULT_TOPIC = process.env.TOPIC || 'iot/demo/temperature'

const LIMITS = {
    intervalMs: [500, 60000],
    min: [-50, 100],
    max: [-50, 100],
}

function validateConfig(config) {
    const { intervalMs, min, max } = config
    if (!Number.isFinite(intervalMs) || intervalMs < LIMITS.intervalMs[0] || intervalMs > LIMITS.intervalMs[1]) {
        throw new RangeError(`发布间隔需在 ${LIMITS.intervalMs[0]} ~ ${LIMITS.intervalMs[1]} ms 之间`)
    }
    if (!Number.isFinite(min) || min < LIMITS.min[0] || min > LIMITS.min[1]) {
        throw new RangeError(`温度下限需在 ${LIMITS.min[0]} ~ ${LIMITS.min[1]} ℃ 之间`)
    }
    if (!Number.isFinite(max) || max < LIMITS.max[0] || max > LIMITS.max[1]) {
        throw new RangeError(`温度上限需在 ${LIMITS.max[0]} ~ ${LIMITS.max[1]} ℃ 之间`)
    }
    if (min >= max) {
        throw new RangeError('温度下限必须小于上限')
    }
    return { intervalMs, min, max }
}

class Publisher extends EventEmitter {
    constructor(options = {}) {
        super()
        this.url = options.url || DEFAULT_URL
        this.topic = options.topic || DEFAULT_TOPIC
        this.username = options.username || process.env.MQTT_USERNAME || undefined
        this.password = options.password || process.env.MQTT_PASSWORD || undefined
        this.config = validateConfig({
            intervalMs: options.intervalMs || 3000,
            min: options.min !== undefined ? options.min : 25,
            max: options.max !== undefined ? options.max : 30,
        })
        this.connected = false
        this.running = false
        this.client = null
        this.timer = null
    }

    log(level, message) {
        this.emit('log', { level, message, ts: Date.now() })
    }

    emitError(err) {
        if (this.listenerCount('error') > 0) {
            this.emit('error', err)
        }
    }

    status() {
        return {
            connected: this.connected,
            running: this.running,
            config: { ...this.config },
            url: this.url,
            topic: this.topic,
        }
    }

    connect() {
        if (this.client) return this

        const options = {
            clientId: `iot-publisher-${Math.random().toString(16).slice(2, 8)}`,
            reconnectPeriod: 2000,
            connectTimeout: 5000,
        }
        if (this.username) options.username = this.username
        if (this.password) options.password = this.password

        this.log('info', `开始连接 ${this.url}`)
        const client = mqtt.connect(this.url, options)
        this.client = client

        client.on('connect', () => {
            this.connected = true
            this.log('success', `publisher 连上 Broker：${this.url}`)
            this.emit('status', this.status())
            if (this.running) this.schedule()
        })

        client.on('reconnect', () => {
            this.log('info', '正在重连 Broker ...')
        })

        client.on('close', () => {
            if (this.connected) {
                this.connected = false
                this.clearTimer()
                this.log('warn', '与 Broker 的连接已断开')
                this.emit('status', this.status())
            }
        })

        client.on('error', (err) => {
            this.log('error', `发布端错误：${err.message}`)
            this.emitError(err)
        })

        return this
    }

    schedule() {
        this.clearTimer()
        this.timer = setInterval(() => this.publishOnce(), this.config.intervalMs)
    }

    clearTimer() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
    }

    start() {
        if (!this.connected) {
            this.log('error', 'Broker 未连接，无法开始发布')
            return false
        }
        if (this.running) return true

        this.running = true
        this.schedule()
        this.log('info', `开始定时发布，间隔 ${this.config.intervalMs} ms`)
        this.emit('status', this.status())
        return true
    }

    stop() {
        if (!this.running) return true

        this.running = false
        this.clearTimer()
        this.log('info', '已暂停发布')
        this.emit('status', this.status())
        return true
    }

    publishOnce() {
        if (!this.client || !this.connected) return null

        const { min, max } = this.config
        const temperature = Number((min + Math.random() * (max - min)).toFixed(2))
        this.client.publish(this.topic, `{"temperature":${temperature}}`)

        const reading = { temperature, ts: Date.now(), topic: this.topic }
        this.emit('published', reading)
        this.log('success', `已发布温度：${temperature.toFixed(2)} ℃`)
        return reading
    }

    updateConfig(patch = {}) {
        const next = validateConfig({ ...this.config, ...patch })
        this.config = next
        if (this.running) this.schedule()
        this.log('info', `配置已更新：间隔 ${next.intervalMs} ms，温度 ${next.min} ~ ${next.max} ℃`)
        this.emit('config', { ...next })
        return { ...next }
    }

    close() {
        this.stop()
        if (this.client) {
            this.client.end(true)
            this.client = null
        }
        this.connected = false
    }
}

function createPublisher(options) {
    return new Publisher(options)
}

module.exports = { createPublisher, Publisher, validateConfig, LIMITS }

// 以脚本方式运行时保持原有行为
if (require.main === module) {
    const publisher = createPublisher()

    publisher.on('log', (entry) => console.log(entry.message))
    publisher.on('status', (status) => {
        if (status.connected && !status.running) publisher.start()
    })
    publisher.on('error', (err) => {
        console.log('❌ 发布端错误：', err.message)
    })

    publisher.connect()

    process.on('SIGINT', () => {
        publisher.close()
        process.exit(0)
    })
}
