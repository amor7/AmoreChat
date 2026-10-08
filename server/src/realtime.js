// Thin wrapper around the Socket.IO server so route modules can emit events
// without importing the server instance directly.
let io = null;
export const setIO = (instance) => {
  io = instance;
};

export const toChat = (chatId, event, data) => io?.to(`chat:${chatId}`).emit(event, data);
export const toUser = (userId, event, data) => io?.to(`user:${userId}`).emit(event, data);
export const toAll = (event, data) => io?.emit(event, data);

export const joinChat = (userId, chatId) => io?.in(`user:${userId}`).socketsJoin(`chat:${chatId}`);
export const leaveChat = (userId, chatId) => io?.in(`user:${userId}`).socketsLeave(`chat:${chatId}`);
export const disconnectUser = (userId) => io?.in(`user:${userId}`).disconnectSockets(true);

// userId -> number of open sockets
export const online = new Map();
export const isOnline = (userId) => (online.get(userId) || 0) > 0;
