const mqtt = require('mqtt')
console.log("【发布端】开始连接 localhost:1883")
const client = mqtt.connect("mqtt://127.0.0.1:1883")

client.on('connect', () => {
    console.log("✅ publisher 连上Broker，开始定时上报温度")
    // 每3秒发一条
    setInterval(()=>{
        let temp = (25 + Math.random()*5).toFixed(2)
        client.publish("iot/demo/temperature", `{"temperature":${temp}}`)
        console.log(`📤 已发布温度：${temp} ℃`)
    },3000)
})

client.on('error', (err) => {
    console.log("❌ 发布端错误：", err.message)
})