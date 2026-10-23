# Git Operations Policy

## 1. Git Push Condition
- `git push` is allowed ONLY when the user **explicitly requests or instructs** it in writing within the prompt (e.g., "push to github", "git push", "push code").
- In all other automated workflows, keep changes strictly local until explicitly confirmed by the user.

## 2. Local Commits & Staging
- Proactively stage files (`git add`) and create clean, atomic commits (`git commit`) locally whenever completing a feature, bugfix, or chore.
