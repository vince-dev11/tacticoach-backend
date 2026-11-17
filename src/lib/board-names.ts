// NAMES-ALL (owner, 17 Nov 2026): "Hide all player names". The web app hides
// a team's names by setting that team's nameplate to 'none' (or 'role'), and
// every renderer obeys it — but the names were still INSIDE the board's saved
// state, so anyone reading a public board's data could see them. When a board
// is served to someone who is not its owner, the names a coach chose not to
// show are taken out of the data itself.
//
// Names the coach left showing (nameplate 'name', the default) are served as
// drawn — the owner's PUBLIC-DEFAULT decision of the same day. The owner's own
// copy is never touched, so showing the names again brings them back.

type Team = 'home' | 'away' | 'neutral'
interface FabricObject { tcType?: string; tcKey?: string; tcProps?: Record<string, unknown> }
interface BoardState {
  canvas?: { objects?: FabricObject[]; tcMeta?: { teamStyles?: Partial<Record<Team, { nameplate?: string }>>; steps?: { board?: unknown }[] } }
}

/** The web's `teamForKey`. */
const teamOf = (key: string | undefined): Team => (key === 'player_red' ? 'away' : key === 'player_yellow' ? 'neutral' : 'home')

/** A copy of a saved board without the names of teams whose names are hidden. Anything unexpected is returned untouched. */
export function stripHiddenNames<T>(state: T): T {
  const s = state as BoardState | null
  const canvas = s?.canvas
  if (!s || typeof s !== 'object' || !canvas || !Array.isArray(canvas.objects)) return state
  const styles = canvas.tcMeta?.teamStyles ?? {}
  const hidden = (t: Team) => (styles[t]?.nameplate ?? 'name') !== 'name'
  const objects = canvas.objects.map((o) => {
    if (o?.tcType !== 'player' || !o.tcProps || !('name' in o.tcProps) || !hidden(teamOf(o.tcKey))) return o
    const { name: _gone, ...rest } = o.tcProps
    void _gone
    return { ...o, tcProps: rest }
  })
  const steps = canvas.tcMeta?.steps
  const tcMeta = Array.isArray(steps)
    ? { ...canvas.tcMeta, steps: steps.map((st) => (st && st.board ? { ...st, board: stripHiddenNames(st.board) } : st)) }
    : canvas.tcMeta
  return { ...s, canvas: { ...canvas, objects, ...(tcMeta !== undefined && { tcMeta }) } } as T
}
