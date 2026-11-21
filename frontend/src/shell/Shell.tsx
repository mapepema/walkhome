import { lazy, Suspense, type ComponentType } from "react"
import { motion } from "framer-motion"
import { selSession, useStore } from "@/lib/store"
import { useRoute, type Tab } from "@/lib/router"
import { useUi } from "@/lib/ui"
import { Skeleton } from "@/kit/ui"
import { BottomBar, Sidebar } from "./Nav"
import { TopBar } from "./TopBar"
import { NotificationCenter } from "./NotificationCenter"
import { RewardLayer } from "./RewardLayer"
import { RankLayer } from "./RankLayer"
import { StoryLayer } from "./StoryLayer"
import { ManualSheet } from "@/views/walk/ManualSheet"
import { Camp } from "@/views/Camp"

const Walk = lazy(() => import("@/views/Walk").then((m) => ({ default: m.Walk })))
const Quests = lazy(() => import("@/views/Quests").then((m) => ({ default: m.Quests })))
const Race = lazy(() => import("@/views/Race").then((m) => ({ default: m.Race })))
const MapView = lazy(() => import("@/views/MapView").then((m) => ({ default: m.MapView })))
const Profile = lazy(() => import("@/views/Profile").then((m) => ({ default: m.Profile })))
const Packs = lazy(() => import("@/lib/tcg").then((m) => ({ default: m.PacksView as ComponentType })))
const Collection = lazy(() => import("@/lib/tcg").then((m) => ({ default: m.CollectionView as ComponentType })))
const PackOpening = lazy(() => import("@/lib/tcg").then((m) => ({ default: m.PackOpeningOverlay })))

const VIEWS: Record<Tab, ComponentType> = {
  camp: Camp,
  walk: Walk,
  quests: Quests,
  packs: Packs,
  collection: Collection,
  race: Race,
  map: MapView,
  profile: Profile,
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-4" aria-busy>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-56" />
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
    </div>
  )
}

export function Shell() {
  const { tab } = useRoute()
  const immersive = useStore((s) => !!selSession(s)) && tab === "walk"
  const grant = useUi((s) => s.openingGrant)
  const openPack = useUi((s) => s.openPack)
  const refresh = useStore((s) => s.refresh)
  const bump = useStore((s) => s.bump)
  const View = VIEWS[tab]

  return (
    <div className="relative min-h-dvh">
      <div className="backdrop" aria-hidden />
      {!immersive && <Sidebar />}
      {!immersive && <TopBar />}
      <main
        id="main"
        className={immersive ? "" : "pb-nav lg:pl-[284px]"}
      >
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className={immersive ? "" : "mx-auto w-full max-w-[1240px] px-4 pt-2 lg:px-9 lg:pt-8"}
        >
          <Suspense fallback={<PageSkeleton />}>
            <View />
          </Suspense>
        </motion.div>
      </main>
      {!immersive && <BottomBar />}
      <NotificationCenter />
      <ManualSheet />
      <StoryLayer />
      <RewardLayer />
      <RankLayer />
      {grant && (
        <Suspense fallback={null}>
          <PackOpening
            grant={grant}
            onDone={() => {
              openPack(null)
              refresh()
              bump()
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
