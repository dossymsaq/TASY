import React from 'react';
// Простая навигация: вкладки по ролям + стек экранов поверх вкладок
export const Nav = React.createContext({ push: () => {}, pop: () => {}, user: null, cfg: null, setUser: () => {}, logout: () => {} });
export const useNav = () => React.useContext(Nav);
