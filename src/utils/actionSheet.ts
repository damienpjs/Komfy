/**
 * Context menu: native ActionSheet on iOS, button Alert on Android.
 */

import { ActionSheetIOS, Alert, Platform } from 'react-native';

export interface SheetAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export function showActionSheet(title: string, actions: SheetAction[]): void {
  if (Platform.OS === 'ios') {
    const options = [...actions.map((a) => a.label), 'Annuler'];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: actions
          .map((a, i) => (a.destructive ? i : -1))
          .filter((i) => i >= 0),
      },
      (index) => {
        if (index < actions.length) actions[index].onPress();
      },
    );
  } else {
    Alert.alert(title, undefined, [
      ...actions.map((a) => ({
        text: a.label,
        style: a.destructive ? ('destructive' as const) : undefined,
        onPress: a.onPress,
      })),
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  }
}
