import { Hero } from "./camp/Hero"
import { WalkCta } from "./camp/WalkCta"
import { MilestoneCard } from "./camp/MilestoneCard"
import { PackCard } from "./camp/PackCard"
import { QuestStrip } from "./camp/QuestStrip"
import { MiniRace } from "./camp/MiniRace"
import { StreakCard } from "./camp/StreakCard"
import { useStore } from "@/lib/store"

/** Home: hero + the one big button, then what to do next. Two columns on desktop. */
export function Camp() {
  const name = useStore((s) => s.me?.display_name)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
      <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
        <Hero />
        <div className="lg:hidden"><WalkCta /></div>
        <MilestoneCard />
        <QuestStrip />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
        <div className="hidden lg:block"><WalkCta /></div>
        <PackCard />
        <MiniRace />
        <StreakCard />
        <span className="sr-only">{name}'s camp</span>
      </div>
    </div>
  )
}
