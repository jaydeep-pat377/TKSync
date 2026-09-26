#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LocationAuthModule, NSObject)

RCT_EXTERN_METHOD(getAuthorizationStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
