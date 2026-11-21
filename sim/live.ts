/**
 * Live test on the organizers' real engine (play.joinbuilders.org): create a private room, join as the only
 * player (empty seats are the server's house bots, free-for-all), run our bot in-process, print the result.
 *
 *   bun sim/live.ts [--n 1] [--set key=val,...] [--tag name]
 *
 * Each line of output: {"tag", "place", "kills", "t", "dealt", "taken", "maxMs"}.
 * A test tool only; excluded from the submitted image by .dockerignore.
 */
import { Turtle } from "../src/main.ts"
import { draw } from "../src/mechfight.ts"

const HOST = "play.joinbuilders.org"
const args = Object.fromEntries(process.argv.slice(2).reduce((acc: string[][], a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []))
const N = Number(args.n ?? 1)
const TAG = args.tag ?? "base"
const over: Record<string, unknown> = {}
for (const kv of (args.set ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=")
  over[k] = v === "true" ? true : v === "false" ? false : Number(v)
}
// --cmd "<command...>": bridge an external bot process (stdin/stdout JSON lines) instead of our in-process bot.
// --mapdir: map path to put in hello for that process (e.g. /arena inside a docker sandbox).
const CMD: string[] | null = args.cmd ? args.cmd.split(" ").filter(Boolean) : null
const MAPDIR = args.mapdir ?? "kit/arena"
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("")

function playOne(): Promise<any> {
  return new Promise(async (resolve) => {
    const sid = hex(16)
    const res = await fetch(`https://${HOST}/mm/code/new?sid=${sid}`, { headers: { "User-Agent": "mech-bot-tester" } })
    const { room, code } = (await res.json()) as any
    const ws = new WebSocket(`wss://${HOST}/r/${room}/play?token=&sid=${sid}&name=mr-test&code=${code}`, {
      headers: { Origin: `https://${HOST}`, "User-Agent": "mech-bot-tester" },
    } as any)
    let bot: Turtle | null = null
    let proc: any = null
    let started = false
    const out: any = { tag: TAG, room, place: null, kills: null, t: 0, dealt: 0, taken: 0, maxMs: 0 }
    const timer = setTimeout(() => {
      out.error = "timeout"
      ws.close()
    }, 900_000)
    const send = (m: unknown) => ws.send(JSON.stringify(m))
    ws.onmessage = (ev) => {
      let m: any
      try {
        m = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (m.type === "lobby") {
        if (!m.you?.ready) send({ type: "ready", name: "mr-test" })
        if (m.you?.host && m.phase === "waiting" && !started) {
          started = true
          setTimeout(() => send({ type: "start" }), 500)
        }
      } else if (m.type === "hello" && CMD) {
        m.map.dir = MAPDIR
        proc = Bun.spawn(CMD, { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
        ;(async () => {
          const dec = new TextDecoder()
          let buf = ""
          for await (const chunk of proc!.stdout as any) {
            buf += dec.decode(chunk)
            let k
            while ((k = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, k).trim()
              buf = buf.slice(k + 1)
              if (!line) continue
              try {
                const a = JSON.parse(line)
                if (a.type !== "ready") ws.send(line)
              } catch {}
            }
          }
        })()
        proc.stdin.write(JSON.stringify(m) + "\n")
        proc.stdin.flush()
        send({ type: "loaded" })
      } else if (m.type === "obs" && CMD && proc) {
        out.t = m.t
        for (const e of m.events ?? []) {
          if (e.type === "hit" && e.target < 16) out.dealt += e.amount
          if (e.type === "damaged") out.taken += e.amount
        }
        proc.stdin.write(JSON.stringify(m) + "\n")
        proc.stdin.flush()
      } else if (m.type === "hello") {
        m.map.dir = "kit/arena"
        bot = new Turtle(m, over as any)
        send({ type: "loaded" })
      } else if (m.type === "obs" && bot) {
        out.t = m.t
        for (const e of m.events ?? []) {
          if (e.type === "hit" && e.target < 16) out.dealt += e.amount
          if (e.type === "damaged") out.taken += e.amount
        }
        const t0 = performance.now()
        draw.clear()
        let a: any = {}
        try {
          a = bot.act(m) ?? {}
        } catch (e) {
          out.errors = (out.errors ?? 0) + 1
        }
        out.maxMs = Math.max(out.maxMs, performance.now() - t0)
        draw.take()
        send({ ...a, tick: m.tick })
      } else if (m.type === "end") {
        try {
          proc?.stdin.write(JSON.stringify(m) + "\n")
          proc?.stdin.end()
        } catch {}
        out.place = m.place
        out.kills = m.kills
        clearTimeout(timer)
        ws.close()
      }
    }
    ws.onclose = () => {
      clearTimeout(timer)
      out.dealt = Math.round(out.dealt)
      out.taken = Math.round(out.taken)
      out.maxMs = Math.round(out.maxMs * 10) / 10
      resolve(out)
    }
    ws.onerror = () => {
      out.error = out.error ?? "ws error"
    }
  })
}

for (let k = 0; k < N; k++) console.log(JSON.stringify(await playOne()))
process.exit(0)
