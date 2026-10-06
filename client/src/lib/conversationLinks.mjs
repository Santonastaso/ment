export function sessionPath(session) {
  return session?.route_token
    ? `/c/${encodeURIComponent(session.route_token)}`
    : `/conversations?session=${session.id}`;
}

export function groupPath(group) {
  return group?.route_token
    ? `/g/${encodeURIComponent(group.route_token)}`
    : `/conversations?group=${group.id}`;
}
