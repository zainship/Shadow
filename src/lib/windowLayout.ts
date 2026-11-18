import type {
  AutomationStep,
  PageInspectionResult,
  WindowLayoutMode,
  WindowTilePlacement,
} from '../types/assistant';

export function normalizeWindowLayoutMode(raw: unknown): WindowLayoutMode {
  const val = String(raw || '').toLowerCase().trim();
  if (val === 'side-by-side' || val === 'side_by_side' || val === 'split' || val === 'columns') {
    return 'side-by-side';
  }
  if (val === 'focus-split' || val === 'focus_split' || val === 'focus' || val === 'primary-stack') {
    return 'focus-split';
  }
  return 'grid';
}

export function parseAppsList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item || '').trim()).filter(Boolean);
        }
      } catch {
        // fall through to delimiter splitting
      }
    }
    return trimmed
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function computeWindowTilePlacements(
  apps: string[],
  layout: WindowLayoutMode,
  gapPct = 1.5
): WindowTilePlacement[] {
  const cleanApps = apps.map((a) => a.trim()).filter(Boolean);
  const count = cleanApps.length;
  if (count === 0) return [];

  if (count === 1) {
    return [
      {
        appName: cleanApps[0],
        xPct: gapPct,
        yPct: gapPct,
        widthPct: 100 - gapPct * 2,
        heightPct: 100 - gapPct * 2,
      },
    ];
  }

  if (layout === 'side-by-side') {
    const totalGap = gapPct * (count + 1);
    const tileW = (100 - totalGap) / count;
    const tileH = 100 - gapPct * 2;
    return cleanApps.map((appName, idx) => ({
      appName,
      xPct: gapPct + idx * (tileW + gapPct),
      yPct: gapPct,
      widthPct: tileW,
      heightPct: tileH,
    }));
  }

  if (layout === 'focus-split') {
    const primaryW = (100 - gapPct * 3) * 0.6;
    const stackW = (100 - gapPct * 3) * 0.4;
    const stackCount = count - 1;
    const stackH = (100 - gapPct * (stackCount + 1)) / stackCount;

    return cleanApps.map((appName, idx) => {
      if (idx === 0) {
        return {
          appName,
          xPct: gapPct,
          yPct: gapPct,
          widthPct: primaryW,
          heightPct: 100 - gapPct * 2,
        };
      }
      const stackIdx = idx - 1;
      return {
        appName,
        xPct: gapPct * 2 + primaryW,
        yPct: gapPct + stackIdx * (stackH + gapPct),
        widthPct: stackW,
        heightPct: stackH,
      };
    });
  }

  // Grid layout: balanced columns x rows
  const cols = count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellH = (100 - gapPct * (rows + 1)) / rows;

  return cleanApps.map((appName, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const isLastRow = row === rows - 1;
    const itemsInThisRow = isLastRow ? count - row * cols : cols;
    const cellW = (100 - gapPct * (itemsInThisRow + 1)) / itemsInThisRow;
    return {
      appName,
      xPct: gapPct + col * (cellW + gapPct),
      yPct: gapPct + row * (cellH + gapPct),
      widthPct: cellW,
      heightPct: cellH,
    };
  });
}

export function buildWindowLayoutInspection(
  layout: WindowLayoutMode,
  apps: string[],
  steps: AutomationStep[]
): PageInspectionResult {
  const placements = computeWindowTilePlacements(
    apps.length > 0 ? apps : ['Browser', 'Editor', 'Terminal', 'Notes'],
    layout
  );
  return {
    url: 'desktop://window-layout',
    finalUrl: `desktop://window-layout?mode=${layout}`,
    title: `Laptop Window Layout (${layout === 'side-by-side' ? 'Side-by-Side' : layout === 'focus-split' ? 'Focus + Stack' : 'Grid'})`,
    statusCode: 200,
    fields: placements.map((p, idx) => ({
      tag: 'window',
      type: `${Math.round(p.widthPct)}% × ${Math.round(p.heightPct)}%`,
      name: `window_${idx + 1}`,
      id: `tile-${idx + 1}`,
      placeholder: `${Math.round(p.xPct)}%, ${Math.round(p.yPct)}%`,
      label: p.appName,
      selector: `window[app="${p.appName}"]`,
      filledValue: `${Math.round(p.widthPct)}% × ${Math.round(p.heightPct)}% @ (${Math.round(p.xPct)}%, ${Math.round(p.yPct)}%)`,
    })),
    buttons: ['Arrange Side-by-Side', 'Arrange Grid', 'Refresh Open Windows'],
    links: [],
    headings: [
      `Layout Mode: ${layout}`,
      ...placements.map(
        (p) => `${p.appName}: ${Math.round(p.widthPct)}% × ${Math.round(p.heightPct)}%`
      ),
    ],
    excerpt: `Browser automation plan with ${steps.length} step(s) targeting ${placements.length} laptop window(s) in ${layout} formation.`,
  };
}
