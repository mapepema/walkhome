import { useState } from "react"
import { Bell, BellOff, KeyRound, LogOut, Loader2 } from "lucide-react"
import { Switch } from "radix-ui"
import { errMsg, post } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import { disablePush, enablePush, pushCapable } from "@/lib/push"
import { fmtNum, fromUnit, unitLabel } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { Field } from "@/kit/Field"
import { AvatarPicker, ThemePicker } from "@/kit/pickers"
import { Panel, SectionHead, Segmented } from "@/kit/ui"
import { toast } from "sonner"
import type { Units } from "@/lib/types"

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><div className="text-sm font-semibold">{title}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>{children}</div>
}

export function Settings() {
  const tr = useT()
  const me = useStore((s) => s.me)!
  const themes = useStore((s) => s.themes)
  const patchMe = useStore((s) => s.patchMe)
  const logout = useStore((s) => s.logout)
  const [name, setName] = useState(me.display_name)
  const [goal, setGoal] = useState(fmtNum(me.daily_goal_m, me.units, 1))
  const [pw, setPw] = useState({ old: "", next: "" })
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (k: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(k)
    try { await fn(); haptic.success(); if (ok) toast.success(ok) } catch (e) { haptic.warn(); toast.error(errMsg(e)) } finally { setBusy(null) }
  }
  const togglePush = (on: boolean) => run("push", async () => { if (on) await enablePush(); else await disablePush(); await useStore.getState().refresh() }, on ? "Notifications enabled" : "Notifications disabled")
  const pushOk = pushCapable()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Panel className="p-5">
          <SectionHead title="Profile" />
          <div className="flex flex-col gap-4">
            <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} right={name !== me.display_name && <button onClick={() => run("name", () => patchMe({ display_name: name.trim() }), "Name updated")} className="text-xs font-bold text-gold">Save</button>} />
            <AvatarPicker avatar={me.avatar} color={me.color} onAvatar={(a) => patchMe({ avatar: a })} onColor={(c) => patchMe({ color: c })} />
          </div>
        </Panel>
        <Panel className="p-5">
          <SectionHead title="Preferences" />
          <div className="divide-y divide-[var(--line)]">
            <Row title="Units" hint="Distances and speeds"><Segmented<Units> value={me.units} onChange={(u) => patchMe({ units: u })} options={[{ value: "km", label: "km" }, { value: "mi", label: "miles" }]} /></Row>
            <Row title="Daily goal" hint="Used by the calendar and reminders">
              <div className="flex items-center gap-2">
                <input aria-label="Daily goal" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} onBlur={() => { const v = parseFloat(goal.replace(",", ".")); if (v > 0) patchMe({ daily_goal_m: Math.round(fromUnit(v, me.units)) }).catch((e) => toast.error(errMsg(e))) }} className="tnum h-10 w-20 rounded-xl border border-[var(--line)] bg-black/25 px-3 text-right text-sm outline-none focus:border-[var(--th-accent)]" />
                <span className="text-sm text-muted-foreground">{unitLabel(me.units)}</span>
              </div>
            </Row>
            <Row title="Push notifications" hint={pushOk ? (me.push.supported ? "Overtakes, packs, streak at risk" : "Not configured on the server") : "Unavailable in this browser"}>
              {busy === "push" ? <Loader2 className="size-5 animate-spin" /> : (
                <Switch.Root checked={me.push.subscribed} disabled={!pushOk || !me.push.supported} onCheckedChange={togglePush} aria-label="Push notifications" className="relative h-7 w-12 shrink-0 rounded-full bg-white/15 transition-colors data-[state=checked]:bg-[var(--th-accent)] disabled:opacity-40">
                  <Switch.Thumb className="flex size-6 translate-x-0.5 items-center justify-center rounded-full bg-white text-black shadow transition-transform data-[state=checked]:translate-x-[22px]">{me.push.subscribed ? <Bell className="size-3" /> : <BellOff className="size-3" />}</Switch.Thumb>
                </Switch.Root>
              )}
            </Row>
          </div>
        </Panel>
      </div>
      <div className="flex flex-col gap-4">
        <Panel className="p-5">
          <SectionHead title="Quest theme" />
          <p className="-mt-1 mb-3 text-xs text-muted-foreground">Each theme has its own road, cards and progress. You can switch without losing anything.</p>
          {themes.length > 0 && <ThemePicker compact themes={themes} value={me.journey_id} onChange={(t) => t.id !== me.journey_id && run("theme", () => patchMe({ journey_id: t.id }), `Theme: ${t.name}`)} />}
        </Panel>
        <Panel className="p-5">
          <SectionHead title="Security" />
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run("pw", async () => { await post("/me/password", { old: pw.old, new: pw.next }); setPw({ old: "", next: "" }) }, "Password changed") }}>
            <Field label="Current password" type="password" autoComplete="current-password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} required />
            <Field label="New password" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required hint="At least 8 characters" />
            <button disabled={busy === "pw"} className="btn-ghost-gold flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold"><KeyRound className="size-4" /> Change password</button>
          </form>
        </Panel>
        <button onClick={() => logout()} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-red-400/30 bg-red-400/8 text-sm font-semibold text-red-300 hover:bg-red-400/15"><LogOut className="size-4" /> {tr.logout}</button>
      </div>
    </div>
  )
}
