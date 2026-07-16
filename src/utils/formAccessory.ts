/**
 * "Done" bar above the iOS keyboard, shared by all form fields
 * (multiline inputs have no return-to-validate key).
 */

import { Platform } from 'react-native';

export const KEYBOARD_ACCESSORY_ID = 'komfy-form-done';
export const accessoryId =
  Platform.OS === 'ios' ? KEYBOARD_ACCESSORY_ID : undefined;
