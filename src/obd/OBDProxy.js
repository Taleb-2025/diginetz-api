'use strict'

/**
 * OBDProxy.js
 * TCP proxy — يتصل بـ ELM327 عبر TCP ويرجع الرد
 *
 * Path: src/obd/OBDProxy.js
 */

import net from 'net'

// ── إرسال أمر واحد لـ ELM327 والانتظار حتى الرد ─────────────────────────────
export function obdCommand(host, port, cmd, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const socket  = new net.Socket()
    let   buffer  = ''
    let   settled = false

    const done = (val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(val)
    }

    const fail = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      reject(err)
    }

    // Timeout
    const timer = setTimeout(() => {
      fail(new Error('OBD timeout'))
    }, timeoutMs)

    socket.connect(port, host, () => {
      socket.write(cmd)
    })

    socket.on('data', (data) => {
      buffer += data.toString()
      // ELM327 ينتهي دائماً بـ '>'
      if (buffer.includes('>')) {
        const response = buffer
          .replace('>', '')
          .replace(/\r/g, ' ')
          .trim()
        done(response)
      }
    })

    socket.on('error', fail)
    socket.on('close', () => {
      if (!settled) done(buffer.trim())
    })
  })
}
