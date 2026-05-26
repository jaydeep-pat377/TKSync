import {StyleSheet} from 'react-native';
import {Colors} from './colors';
import {wp} from '../utils/responsive';

export const common = StyleSheet.create({
  // Layout - Row
  row: {flexDirection: 'row'},
  rowCenter: {flexDirection: 'row', alignItems: 'center'},
  rowCenterGap6: {flexDirection: 'row', alignItems: 'center', gap: wp(6)},
  rowCenterGap8: {flexDirection: 'row', alignItems: 'center', gap: wp(8)},
  rowCenterGap10: {flexDirection: 'row', alignItems: 'center', gap: wp(10)},
  rowCenterGap12: {flexDirection: 'row', alignItems: 'center', gap: wp(12)},
  rowBetween: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  rowEndGap8: {flexDirection: 'row', alignItems: 'flex-end', gap: wp(8)},
  rowGap8: {flexDirection: 'row', gap: wp(8)},
  rowGap12: {flexDirection: 'row', gap: wp(12)},
  rowFlex1Gap12: {flexDirection: 'row', flex: 1, gap: wp(12)},
  rowStartFullW: {flexDirection: 'row', gap: wp(8), alignItems: 'flex-start', width: '100%'},

  // Layout - Column
  colGap6: {gap: wp(6)},
  colGap8: {gap: wp(8)},

  // Flex
  flex1: {flex: 1},
  flex1Gap6: {flex: 1, gap: wp(6)},

  // Buttons
  closeBtn: {width: wp(36), height: wp(36), borderRadius: wp(18), justifyContent: 'center', alignItems: 'center'},
  circleBtn: {borderRadius: wp(18), justifyContent: 'center', alignItems: 'center'},

  // Selector
  selectorCompact: {flex: 0, width: wp(220)},

  // Shadows
  shadowSm: {elevation: 2, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.08, shadowRadius: 4},
  shadowMd: {elevation: 8, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.15, shadowRadius: 12},
  shadowLg: {elevation: 16, shadowColor: Colors.shadowColor, shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.25, shadowRadius: 20},

  // Full width
  fullWidth: {width: '100%'},

  // Modal option row
  modalOptionRow: {paddingVertical: wp(9), alignItems: 'center'},

  // Table
  tableRow: {flexDirection: 'row', paddingVertical: wp(8)},

  // Icon box
  iconBox28: {width: wp(28), height: wp(28), borderRadius: wp(9), justifyContent: 'center', alignItems: 'center'},
  iconBox30: {width: wp(30), height: wp(30), borderRadius: wp(8), justifyContent: 'center', alignItems: 'center'},

  // Center
  centered: {justifyContent: 'center', alignItems: 'center'},
});
