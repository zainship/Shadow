import { openRouterGenerate, type AiRuntime } from './ai-provider.ts';
import { getGeminiClient, getModelConfig, withGeminiRetry } from './gemini.ts';

export interface GithubRepoOverview {
  repo: {
    fullName: string;
    description: string;
    stars: number;
    forks: number;
    openIssues: number;
    defaultBranch: string;
    language: string;
    updatedAt: string;
    htmlUrl: string;
    private: boolean;
  };
  pullRequests: Array<{
    number: number;
    title: string;
    user: string;
    state: string;
    draft: boolean;
    updatedAt: string;
    htmlUrl: string;
  }>;
  issues: Array<{
    number: number;
    title: string;
    user: string;
    comments: number;
    updatedAt: string;
    htmlUrl: string;
  }>;
  workflowRuns: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string;
    branch: string;
    createdAt: string;
    htmlUrl: string;
  }>;
  recentCommits: Array<{
    sha: string;
    message: string;
    author: string;
    date: string;
    htmlUrl: string;
  }>;
}

export function parseRepoSlug(rawRepo: string): { owner: string; name: string; fullName: string } {
  const cleaned = String(rawRepo || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('Specify repository as "owner/repo" (for example "facebook/react").');
  }
  const [owner, name] = parts;
  if (!/^[a-zA-Z0-9_.\-]+$/.test(owner) || !/^[a-zA-Z0-9_.\-]+$/.test(name)) {
    throw new Error('Repository owner and name may only contain letters, digits, ., _, and -.');
  }
  return { owner, name, fullName: `${owner}/${name}` };
}

async function githubFetchJson<T>(apiPath: string, token?: string): Promise<T> {
  const effectiveToken = (token || process.env.GITHUB_TOKEN || '').trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Shadow-DevOps-Cockpit',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (effectiveToken) {
    headers.Authorization = `Bearer ${effectiveToken}`;
  }
  const res = await fetch(`https://api.github.com${apiPath}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 404) {
      throw new Error('GitHub repository not found (or private without a GitHub token).');
    }
    if (res.status === 403 && errBody.toLowerCase().includes('rate limit')) {
      throw new Error('GitHub public API rate limit reached; provide a GITHUB_TOKEN to raise limits.');
    }
    throw new Error(`GitHub API HTTP ${res.status}: ${errBody.slice(0, 180)}`);
  }
  return (await res.json()) as T;
}

export async function fetchGithubRepoOverview(
  rawRepo: string,
  token?: string
): Promise<GithubRepoOverview> {
  const { owner, name } = parseRepoSlug(rawRepo);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  const repoMeta = await githubFetchJson<{
    full_name: string;
    description?: string;
    stargazers_count?: number;
    forks_count?: number;
    open_issues_count?: number;
    default_branch?: string;
    language?: string;
    updated_at?: string;
    html_url: string;
    private?: boolean;
  }>(base, token);

  const [prsRes, issuesRes, runsRes, commitsRes] = await Promise.allSettled([
    githubFetchJson<
      Array<{
        number: number;
        title: string;
        user?: { login?: string };
        state: string;
        draft?: boolean;
        updated_at: string;
        html_url: string;
      }>
    >(`${base}/pulls?state=open&per_page=8`, token),
    githubFetchJson<
      Array<{
        number: number;
        title: string;
        user?: { login?: string };
        comments?: number;
        updated_at: string;
        html_url: string;
        pull_request?: unknown;
      }>
    >(`${base}/issues?state=open&per_page=14`, token),
    githubFetchJson<{
      workflow_runs?: Array<{
        id: number;
        name?: string;
        status?: string;
        conclusion?: string;
        head_branch?: string;
        created_at?: string;
        html_url?: string;
      }>;
    }>(`${base}/actions/runs?per_page=8`, token),
    githubFetchJson<
      Array<{
        sha: string;
        commit?: { message?: string; author?: { name?: string; date?: string } };
        html_url?: string;
      }>
    >(`${base}/commits?per_page=8`, token),
  ]);

  const pullRequests =
    prsRes.status === 'fulfilled'
      ? prsRes.value.map((p) => ({
          number: p.number,
          title: p.title,
          user: p.user?.login || 'unknown',
          state: p.state,
          draft: Boolean(p.draft),
          updatedAt: p.updated_at,
          htmlUrl: p.html_url,
        }))
      : [];

  const issues =
    issuesRes.status === 'fulfilled'
      ? issuesRes.value
          .filter((i) => !i.pull_request)
          .slice(0, 8)
          .map((i) => ({
            number: i.number,
            title: i.title,
            user: i.user?.login || 'unknown',
            comments: i.comments ?? 0,
            updatedAt: i.updated_at,
            htmlUrl: i.html_url,
          }))
      : [];

  const workflowRuns =
    runsRes.status === 'fulfilled'
      ? (runsRes.value.workflow_runs || []).map((r) => ({
          id: r.id,
          name: r.name || 'Workflow',
          status: r.status || 'unknown',
          conclusion: r.conclusion || 'in_progress',
          branch: r.head_branch || '',
          createdAt: r.created_at || '',
          htmlUrl: r.html_url || repoMeta.html_url,
        }))
      : [];

  const recentCommits =
    commitsRes.status === 'fulfilled'
      ? commitsRes.value.map((c) => ({
          sha: c.sha.slice(0, 7),
          message: String(c.commit?.message || '').split('\n')[0].slice(0, 140),
          author: c.commit?.author?.name || 'unknown',
          date: c.commit?.author?.date || '',
          htmlUrl: c.html_url || repoMeta.html_url,
        }))
      : [];

  return {
    repo: {
      fullName: repoMeta.full_name,
      description: repoMeta.description || '',
      stars: repoMeta.stargazers_count ?? 0,
      forks: repoMeta.forks_count ?? 0,
      openIssues: repoMeta.open_issues_count ?? 0,
      defaultBranch: repoMeta.default_branch || 'main',
      language: repoMeta.language || 'Multi',
      updatedAt: repoMeta.updated_at || '',
      htmlUrl: repoMeta.html_url,
      private: Boolean(repoMeta.private),
    },
    pullRequests,
    issues,
    workflowRuns,
    recentCommits,
  };
}

export async function summarizeDevopsState(input: {
  overview?: GithubRepoOverview | null;
  localGitText?: string;
  question?: string;
  runtime?: AiRuntime | null;
}): Promise<string> {
  const parts: string[] = [];
  if (input.overview) {
    const o = input.overview;
    parts.push(
      `REPO: ${o.repo.fullName} (${o.repo.language}, ★${o.repo.stars}, branch ${o.repo.defaultBranch})\n` +
        `PRs (${o.pullRequests.length}): ${o.pullRequests.map((p) => `#${p.number} ${p.title}`).join('; ') || 'none'}\n` +
        `Issues (${o.issues.length}): ${o.issues.map((i) => `#${i.number} ${i.title}`).join('; ') || 'none'}\n` +
        `Workflows: ${o.workflowRuns.map((w) => `${w.name}:${w.conclusion || w.status}`).join(', ') || 'none'}\n` +
        `Commits: ${o.recentCommits.map((c) => `${c.sha} ${c.message}`).join(' | ') || 'none'}`
    );
  }
  if (input.localGitText?.trim()) {
    parts.push(`LOCAL GIT WORKSPACE:\n${input.localGitText.trim().slice(0, 5000)}`);
  }
  if (parts.length === 0) {
    throw new Error('Provide either a GitHub repo or local git status to analyze.');
  }

  const prompt = [
    input.question?.trim()
      ? `Answer this engineering question concisely based on the DevOps snapshot: ${input.question.trim()}`
      : 'Summarize the engineering health, CI pipeline status, open pull requests/blockers, and suggested next step in 3-5 crisp bullet points.',
    parts.join('\n\n'),
  ].join('\n\n');

  if (input.runtime?.provider === 'openrouter') {
    const turn = await openRouterGenerate({
      apiKey: input.runtime.apiKey,
      model: input.runtime.model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return turn.text.trim();
  }

  const ai = getGeminiClient(input.runtime?.apiKey);
  const res = await withGeminiRetry(
    () => ai.models.generateContent({ model: getModelConfig().fastText, contents: prompt }),
    1
  );
  return (res.text || '').trim();
}
