const test = require('node:test');
const assert = require('node:assert/strict');
const { canViewConnectionLists, resolveFollowAction } = require('../modules/follows/followAccess');

test('public connection lists remain visible to everyone', () => {
  assert.equal(canViewConnectionLists({ isPrivate: false }), true);
});

test('private connection lists are hidden from anonymous and unrelated viewers', () => {
  assert.equal(canViewConnectionLists({ isPrivate: true }), false);
  assert.equal(canViewConnectionLists({ isPrivate: true, viewerId: 'other', targetId: 'owner' }), false);
});

test('private connection lists are visible to the owner and approved followers only', () => {
  assert.equal(canViewConnectionLists({ isPrivate: true, viewerId: 'owner', targetId: 'owner' }), true);
  assert.equal(canViewConnectionLists({ isPrivate: true, viewerId: 'follower', targetId: 'owner', isFollowing: true }), true);
});

test('following a private account creates a request until approved', () => {
  assert.equal(resolveFollowAction({ isPrivate: true, isFollowing: false, isRequested: false }), 'request');
  assert.equal(resolveFollowAction({ isPrivate: true, isFollowing: false, isRequested: true }), 'cancel_request');
});

test('public follows remain immediate and approved follows can be removed', () => {
  assert.equal(resolveFollowAction({ isPrivate: false, isFollowing: false, isRequested: false }), 'follow');
  assert.equal(resolveFollowAction({ isPrivate: true, isFollowing: true, isRequested: false }), 'unfollow');
});

