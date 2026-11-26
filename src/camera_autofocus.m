#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

// Returns 1 for a supported/accepted request, 0 for an unsupported device,
// and -1 if a supported device refused configuration. No stream is opened.
int camnote_camera_autofocus(const char *name, int perform) {
    @autoreleasepool {
        @try {
            NSString *target = [NSString stringWithUTF8String:name];
            if (target.length == 0) return 0;

            // Match FFmpeg's names without guessing hardware or changing a
            // different camera when duplicate names cannot be distinguished.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            NSArray<AVCaptureDevice *> *devices =
                [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
#pragma clang diagnostic pop
            AVCaptureDevice *camera = nil;
            for (AVCaptureDevice *candidate in devices) {
                if (![candidate.localizedName isEqualToString:target]) continue;
                if (camera) return 0;
                camera = candidate;
            }
            if (!camera) return 0;
            const BOOL oneShot = [camera isFocusModeSupported:AVCaptureFocusModeAutoFocus];
            const BOOL continuous = [camera isFocusModeSupported:AVCaptureFocusModeContinuousAutoFocus];
            if (!oneShot && !(continuous && camera.isFocusPointOfInterestSupported)) return 0;
            if (!perform) return 1;
            if (![camera lockForConfiguration:NULL]) return -1;
            @try {
                if (camera.isFocusPointOfInterestSupported)
                    camera.focusPointOfInterest = CGPointMake(0.5, 0.5);
                camera.focusMode = oneShot ? AVCaptureFocusModeAutoFocus :
                    AVCaptureFocusModeContinuousAutoFocus;
            } @finally {
                [camera unlockForConfiguration];
            }
            return 1;
        } @catch (NSException *exception) {
            (void)exception;
            return perform ? -1 : 0;
        }
    }
}
