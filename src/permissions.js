export function can(permissions, permission) {
  return Array.isArray(permissions) && permissions.includes(permission);
}
