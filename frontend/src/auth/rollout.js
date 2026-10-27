// Which parts of the platform are open (the server's ROLLOUT_BATCH setting). The
// server tells the browser in `user.rollout`; anything it does not mention counts
// as open, so older servers and the tests keep working unchanged.
//
// This only decides what is shown. The server refuses closed features anyway.

export const featureOn = (user, name) => user?.rollout?.features?.[name] !== false;

export const roleOpen = (user, role) => !user?.rollout?.roles || user.rollout.roles.includes(role);
