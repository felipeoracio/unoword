import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
export async function reminder(owner: string, hour: number, minute: number) {
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  )
    throw new Error("Enter a valid 24-hour time.");
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Notifications are not permitted. You can enable them in iOS Settings.",
    );
  await cancelReminder(owner);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: "A little time for your words",
      body: "Your next idea starts with UnoWord. A few words can keep your habit going.",
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
  await AsyncStorage.setItem(
    "uno.mobile.reminder:" + owner,
    JSON.stringify({ id, hour, minute }),
  );
}
export async function cancelReminder(owner: string) {
  const raw = await AsyncStorage.getItem("uno.mobile.reminder:" + owner);
  if (raw) {
    await Notifications.cancelScheduledNotificationAsync(JSON.parse(raw).id);
    await AsyncStorage.removeItem("uno.mobile.reminder:" + owner);
  }
}
