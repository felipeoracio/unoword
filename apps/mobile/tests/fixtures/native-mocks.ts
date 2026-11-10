export const randomUUID = () => crypto.randomUUID();
export const openBrowserAsync = async () => ({ type: "cancel" });
export const setNotificationHandler = () => {};
export const requestPermissionsAsync = async () => ({ status: "granted" });
export const cancelScheduledNotificationAsync = async () => {};
export const scheduleNotificationAsync = async () => "fixture-reminder";
export const SchedulableTriggerInputTypes = { DAILY: "daily" };
export const useRouter = () => ({
  push: (route: string) =>
    (window as any).navigate(route === "/projects" ? "Projects" : route === "/ideas" ? "Ideas" : "Write"),
});
export default {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
