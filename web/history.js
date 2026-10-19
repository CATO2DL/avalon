export function taskHistory(view, questNumber) {
  const proposals = [];
  for (const event of view.events) {
    if (event.questNumber !== questNumber) continue;
    if (event.type === 'team_proposed') proposals.push({ key: `${view.gameId}:${event.sequence}`, leaderId: event.leaderId, team: event.team, vote: null, result: null });
    if (event.type === 'team_vote_resolved') {
      const proposal = proposals.findLast(p => !p.vote);
      if (proposal) proposal.vote = { approved: event.approved, votes: event.votes };
    }
    if (event.type === 'quest_resolved') {
      const proposal = proposals.findLast(p => p.vote?.approved && !p.result);
      if (proposal) proposal.result = { succeeded: event.succeeded, successCount: event.successCount, failCount: event.failCount };
    }
  }
  return proposals;
}
