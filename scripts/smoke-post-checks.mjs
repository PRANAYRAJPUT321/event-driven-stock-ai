// Temporary: posts the smoke report and screenshot thumbnails as check runs
// on the tested commit, where they can be read back through api.github.com.
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA } = process.env
const dir = 'smoke-out'

async function post(name, title, text) {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/check-runs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({
      name,
      head_sha: GITHUB_SHA,
      status: 'completed',
      conclusion: 'neutral',
      output: { title, summary: title, text: text.slice(0, 65000) },
    }),
  })
  console.log(name, r.status)
}

const report = ['report.txt', 'ui.txt']
  .filter((f) => existsSync(`${dir}/${f}`))
  .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
  .join('\n\n')
await post('smoke-report', 'Production smoke report', report || 'no report written')
for (const f of readdirSync(dir).filter((f) => f.startsWith('thumb-') && f.endsWith('.b64'))) {
  const name = f.slice('thumb-'.length, -'.b64'.length)
  await post(`smoke-thumb-${name}`, `Screenshot: ${name}`, readFileSync(`${dir}/${f}`, 'utf8'))
}
