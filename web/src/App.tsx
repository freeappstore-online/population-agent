import { Shell } from './components/Shell.tsx'

export default function App() {
  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="display-font text-3xl font-bold text-[var(--ink)]">population-agent</h1>
          <p className="mt-3 text-[var(--muted)]">Edit <code>web/src/App.tsx</code> to start.</p>
        </div>
      </div>
    </Shell>
  )
}
