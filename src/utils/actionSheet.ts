/**
 * Context menu: native ActionSheet on iOS, button Alert on Android.
 */

import { ActionSheetIOS, Alert, Platform } from 'react-native';
import i18n from '../i18n';

export interface SheetAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export function showActionSheet(
  title: string,
  actions: SheetAction[],
  message?: string,
): void {
  if (Platform.OS === 'ios') {
    const options = [...actions.map((a) => a.label), i18n.t('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
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
    Alert.alert(title, message, [
      ...actions.map((a) => ({
        text: a.label,
        style: a.destructive ? ('destructive' as const) : undefined,
        onPress: a.onPress,
      })),
      { text: i18n.t('common.cancel'), style: 'cancel' as const },
    ]);
  }
}
