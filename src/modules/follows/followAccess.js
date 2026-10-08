function canViewConnectionLists({ isPrivate, viewerId, targetId, isFollowing }) {
  if (!isPrivate) return true;
  return Boolean(viewerId && (viewerId === targetId || isFollowing));
}

function resolveFollowAction({ isPrivate, isFollowing, isRequested }) {
  if (isFollowing) return 'unfollow';
  if (!isPrivate) return 'follow';
  return isRequested ? 'cancel_request' : 'request';
}

module.exports = { canViewConnectionLists, resolveFollowAction };

