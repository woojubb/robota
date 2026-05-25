import 'dotenv/config';
import { Octokit } from '@octokit/rest';
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER ? parseInt(process.env.PR_NUMBER, 10) : undefined;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!ANTHROPIC_API_KEY || !GITHUB_TOKEN || !PR_NUMBER || !REPO_OWNER || !REPO_NAME) {
  throw new Error('Missing required environment variables. See .env.example.');
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: ANTHROPIC_API_KEY }),
  permissionMode: 'bypassPermissions',
  maxTurns: 1,
});

async function fetchPRDiff(owner: string, repo: string, pullNumber: number): Promise<string> {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: 'diff' },
  });
  return data as unknown as string;
}

async function fetchPRInfo(owner: string, repo: string, pullNumber: number) {
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
  return data;
}

async function postReview(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: pullNumber,
    body,
    event: 'COMMENT',
  });
}

async function main(): Promise<void> {
  console.log(`Reviewing PR #${PR_NUMBER} in ${REPO_OWNER}/${REPO_NAME}...`);

  const [pr, diff] = await Promise.all([
    fetchPRInfo(REPO_OWNER!, REPO_NAME!, PR_NUMBER!),
    fetchPRDiff(REPO_OWNER!, REPO_NAME!, PR_NUMBER!),
  ]);

  const truncatedDiff = diff.length > 20000 ? diff.slice(0, 20000) + '\n\n[diff truncated]' : diff;

  const prompt = `You are a senior software engineer reviewing a GitHub pull request.

PR Title: ${pr.title}
PR Description: ${pr.body ?? '(none)'}
Base branch: ${pr.base.ref}
Head branch: ${pr.head.ref}
Changed files: ${pr.changed_files}
Additions: ${pr.additions}, Deletions: ${pr.deletions}

Diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

Provide a concise, actionable code review. Cover:
1. Correctness issues or bugs
2. Security concerns
3. Performance considerations
4. Code quality and maintainability
5. Any missing tests or edge cases

Be specific and reference line numbers where applicable. End with a brief overall assessment.`;

  console.log('Running AI review...');
  const review = await query(prompt);

  await postReview(REPO_OWNER!, REPO_NAME!, PR_NUMBER!, review);
  console.log(`Review posted to PR #${PR_NUMBER}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
