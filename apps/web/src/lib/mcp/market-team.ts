import type { MyTeam } from '@kacp/shared';

// The market lives on the app host (no team in the path). "Current team" = `?team=` when the user is a member,
// else the last team chosen on a market page, else the first team.

const KEY = 'kacp.market.team';

export function rememberMarketTeam(team: string): void {
  try {
    localStorage.setItem(KEY, team);
  } catch {
    // private mode: ignore
  }
}

function lastMarketTeam(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function pickMarketTeam(teams: MyTeam[], requested: string | undefined, last: string | null = lastMarketTeam()): MyTeam | undefined {
  return (
    (requested ? teams.find((t) => t.name === requested) : undefined) ??
    (last ? teams.find((t) => t.name === last) : undefined) ??
    teams[0]
  );
}

/** May this user install/remove MCP in `team`? (06-auth.md §7: team admins, platform admins for any team.) */
export function canManageTeamMcp(team: Pick<MyTeam, 'teamRole'> | undefined, platformRole: string | undefined): boolean {
  return platformRole === 'admin' || team?.teamRole === 'team_admin';
}
