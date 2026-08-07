function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rankRepo(repo, keywords, options = {}) {
  const name = (repo.name || "").toLowerCase();
  const fullName = (repo.full_name || "").toLowerCase();
  const desc = (repo.description || "").toLowerCase();
  const topics = (repo.topics || []).join(" ").toLowerCase();
  const fullText = `${fullName} ${name} ${desc} ${topics}`;

  let score = 0;

  for (const keyword of keywords) {
    const normalized = keyword.toLowerCase();
    if (!normalized) continue;

    if (name.includes(normalized)) score += 6;
    if (fullName.includes(normalized)) score += 4;
    if (desc.includes(normalized)) score += 3.5;
    if (topics.includes(normalized)) score += 5;

    const wholeWordInName = new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(name);
    const wholeWordInFullName = new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(fullName);
    const wholeWordInDesc = new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(desc);
    const wholeWordInTopics = new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(topics);

    if (wholeWordInName) score += 2;
    if (wholeWordInFullName) score += 1.5;
    if (wholeWordInDesc) score += 1.5;
    if (wholeWordInTopics) score += 2.5;

    const pieces = normalized.split(/[-_/.]/).filter(Boolean);
    if (pieces.some((piece) => name.includes(piece) || fullName.includes(piece) || desc.includes(piece) || topics.includes(piece))) {
      score += 1.2;
    }

    if (fullText.includes(normalized)) score += 0.8;
  }

  if (options.recency === "recent" || options.recency === "updated") {
    score += recencyScore(repo, options.recency);
  }

  score += Math.log10((repo.stargazers_count || 0) + 1) * 0.9;
  score += Math.log10((repo.forks_count || 0) + 1) * 0.4;

  if (options.freeMode) score += 0.8;
  if (options.matchMode === "strict") score += 1.2;
  if (repo.archived && !options.includeArchived) score -= 1.5;

  return score;
}

function recencyScore(repo, recency) {
  const now = Date.now();
  const createdAt = repo.created_at ? new Date(repo.created_at).getTime() : 0;
  const updatedAt = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
  const reference = recency === "updated" ? updatedAt || new Date(repo.updated_at || 0).getTime() : createdAt;

  if (!reference) return 0;

  const ageInDays = (now - reference) / (1000 * 60 * 60 * 24);
  if (ageInDays <= 30) return 3.5;
  if (ageInDays <= 90) return 2;
  if (ageInDays <= 180) return 1;
  return 0;
}
