import {StyleSheet} from 'react-native';
import {Colors} from './colors';

export const common = StyleSheet.create({
  // Layout - Row
  row: {flexDirection: 'row'},
  rowCenter: {flexDirection: 'row', alignItems: 'center'},
  rowCenterGap6: {flexDirection: 'row', alignItems: 'center', gap: 6},
  rowCenterGap8: {flexDirection: 'row', alignItems: 'center', gap: 8},
  rowCenterGap10: {flexDirection: 'row', alignItems: 'center', gap: 10},
  rowCenterGap12: {flexDirection: 'row', alignItems: 'center', gap: 12},
  rowBetween: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  rowEndGap8: {flexDirection: 'row', alignItems: 'flex-end', gap: 8},
  rowGap8: {flexDirection: 'row', gap: 8},
  rowGap12: {flexDirection: 'row', gap: 12},
  rowFlex1Gap12: {flexDirection: 'row', flex: 1, gap: 12},
  rowStartFullW: {flexDirection: 'row', gap: 8, alignItems: 'flex-start', width: '100%'},

  // Layout - Column
  colGap6: {gap: 6},
  colGap8: {gap: 8},

  // Flex
  flex1: {flex: 1},
  flex1Gap6: {flex: 1, gap: 6},

  // Buttons
  closeBtn: {width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center'},
  circleBtn: {borderRadius: 18, justifyContent: 'center', alignItems: 'center'},

  // Selector
  selectorCompact: {flex: 0, width: 220},

  // Shadows
  shadowSm: {elevation: 2, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.08, shadowRadius: 4},
  shadowMd: {elevation: 8, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.15, shadowRadius: 12},
  shadowLg: {elevation: 16, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.25, shadowRadius: 20},

  // Full width
  fullWidth: {width: '100%'},

  // Modal option row
  modalOptionRow: {paddingVertical: 16, alignItems: 'center'},

  // Table
  tableRow: {flexDirection: 'row', paddingVertical: 8},

  // Icon box
  iconBox28: {width: 28, height: 28, borderRadius: 9, justifyContent: 'center', alignItems: 'center'},
  iconBox30: {width: 30, height: 30, borderRadius: 8, justifyContent: 'center', alignItems: 'center'},

  // Center
  centered: {justifyContent: 'center', alignItems: 'center'},
});
