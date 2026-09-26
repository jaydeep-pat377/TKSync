// Exposes RCTPromiseResolveBlock / RCTPromiseRejectBlock to Swift native modules.
#import <React/RCTBridgeModule.h>

#if __has_include(<RCTOrientation/Orientation.h>)
#import <RCTOrientation/Orientation.h>
#elif __has_include("Orientation.h")
#import "Orientation.h"
#endif
