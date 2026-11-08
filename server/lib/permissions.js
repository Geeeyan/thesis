const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze([
    'rooms.view', 'rooms.create', 'rooms.update', 'rooms.delete',
    'services.view', 'services.create', 'services.update', 'services.delete',
  ]),
  staff: Object.freeze(['rooms.view', 'services.view']),
  guest: Object.freeze([]),
});

function permissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.guest;
}

function can(role, permission) {
  return permissionsForRole(role).includes(permission);
}

module.exports = { ROLE_PERMISSIONS, permissionsForRole, can };
