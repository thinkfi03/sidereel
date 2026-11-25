// Floating, always-on-top WebKit window for Sidereel.
//
// Usage: Sidereel <url> <width> <height> <x|-1> <y> <mobile:0|1> [managed:0|1]
//
// When managed=1 (launched by the VS Code extension) it speaks a line protocol:
//   stdin  <- "hide" | "show" | "toggle" | "quit"
//   stdout -> "visible 0|1"            whenever visibility changes
//             "tick <playing 0|1> <key>" every TICK_SECONDS (key = reel id or video src)
// and quits when stdin closes (so it never outlives VS Code).
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <signal.h>
#include <unistd.h>

#define TICK_SECONDS 5.0

static NSString *const kDesktopUA =
    @"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    @"(KHTML, like Gecko) Version/18.0 Safari/605.1.15";
static NSString *const kMobileUA =
    @"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    @"(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// On Reels pages: one wheel/trackpad flick = next/prev reel; also ↓/↑ and j/k keys.
static NSString *const kScrollJS =
    @"(function(){"
     "const onReels=()=>/^\\/reels?\\//.test(location.pathname);"
     "function scroller(){let best=null,ba=0;"
       "for(const el of document.querySelectorAll('div,main,section')){"
         "if(el.clientHeight<200||el.scrollHeight<=el.clientHeight+50)continue;"
         "const oy=getComputedStyle(el).overflowY;if(!/(auto|scroll)/.test(oy))continue;"
         "const a=el.clientHeight*el.clientWidth;if(a>ba){ba=a;best=el;}}"
       "return best||document.scrollingElement;}"
     "let last=0;"
     "function go(d){const t=Date.now();if(t-last<500)return;last=t;"
       "const s=scroller();s.scrollBy({top:d*s.clientHeight,behavior:'smooth'});}"
     "const editing=()=>{const a=document.activeElement;return a&&(/INPUT|TEXTAREA/.test(a.tagName)||a.isContentEditable);};"
     "window.addEventListener('wheel',e=>{if(!onReels()||editing())return;"
       "if(e.target.closest&&e.target.closest('[role=dialog]'))return;"
       "e.preventDefault();if(Math.abs(e.deltaY)>=4)go(e.deltaY>0?1:-1);},{passive:false,capture:true});"
     "window.addEventListener('keydown',e=>{if(!onReels()||editing())return;"
       "if(e.key==='ArrowDown'||e.key==='j'){e.preventDefault();go(1);}"
       "else if(e.key==='ArrowUp'||e.key==='k'){e.preventDefault();go(-1);}},true);"
     "})();";

// Returns "<playing>|<key>" for the stats tick.
static NSString *const kStatusJS =
    @"(function(){"
     "const vs=[...document.querySelectorAll('video')];"
     "const p=vs.find(v=>!v.paused&&!v.ended&&v.readyState>2);"
     "const m=location.pathname.match(/^\\/reels?\\/([^\\/?#]+)/);"
     "const key=m?m[1]:(p?(p.currentSrc||'').slice(-48):'');"
     "return (p?'1':'0')+'|'+key.replace(/\\s/g,'');"
     "})()";

static NSString *const kPauseJS = @"document.querySelectorAll('video').forEach(v=>v.pause());";

static void emit(NSString *line) {
    NSData *d = [[line stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding];
    (void)write(STDOUT_FILENO, d.bytes, d.length);
}

@interface AppDelegate : NSObject <NSApplicationDelegate, WKUIDelegate, NSWindowDelegate>
@property(strong) NSWindow *window;
@property(strong) WKWebView *webView;
@property(copy) NSArray<NSString *> *args;
@property(strong) NSMutableString *inBuf;
@property BOOL managed;
@property BOOL shown;
@end

@implementation AppDelegate

- (NSString *)arg:(NSUInteger)i fallback:(NSString *)d {
    return self.args.count > i ? self.args[i] : d;
}

- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSString *urlString = [self arg:1 fallback:@"https://www.instagram.com/reels/"];
    CGFloat width = [[self arg:2 fallback:@"420"] doubleValue];
    CGFloat height = [[self arg:3 fallback:@"860"] doubleValue];
    double xArg = [[self arg:4 fallback:@"-1"] doubleValue];
    double yArg = [[self arg:5 fallback:@"60"] doubleValue];
    BOOL mobile = [[self arg:6 fallback:@"0"] isEqualToString:@"1"];
    self.managed = [[self arg:7 fallback:@"0"] isEqualToString:@"1"];

    NSScreen *main = [NSScreen mainScreen];
    NSRect full = main ? main.frame : NSMakeRect(0, 0, 1440, 900);
    NSRect visible = main ? main.visibleFrame : full;
    CGFloat x = xArg >= 0 ? xArg : NSMaxX(visible) - width;
    // Cocoa's origin is bottom-left; y is given as distance from the top of the screen.
    CGFloat y = MAX(NSMinY(visible), NSMaxY(full) - yArg - height);

    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(x, y, width, height)
                  styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                            NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable
                    backing:NSBackingStoreBuffered
                      defer:NO];
    self.window.title = @"Sidereel";
    self.window.level = NSFloatingWindowLevel;  // always on top
    self.window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                     NSWindowCollectionBehaviorFullScreenAuxiliary;
    self.window.releasedWhenClosed = NO;
    self.window.delegate = self;
    // Hidden (boss key) != closed: never let macOS auto-quit us while hidden.
    [[NSProcessInfo processInfo] disableAutomaticTermination:@"sidereel"];

    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = [WKWebsiteDataStore defaultDataStore];  // persists login
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    [config.userContentController addUserScript:
        [[WKUserScript alloc] initWithSource:kScrollJS
                               injectionTime:WKUserScriptInjectionTimeAtDocumentEnd
                            forMainFrameOnly:YES]];

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    self.webView.customUserAgent = mobile ? kMobileUA : kDesktopUA;
    self.webView.UIDelegate = self;
    self.window.contentView = self.webView;

    NSURL *url = [NSURL URLWithString:urlString];
    if (url) [self.webView loadRequest:[NSURLRequest requestWithURL:url]];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    self.shown = YES;
    emit(@"visible 1");

    if (self.managed) [self listenOnStdin];
    [NSTimer scheduledTimerWithTimeInterval:TICK_SECONDS
                                     target:self
                                   selector:@selector(tick)
                                   userInfo:nil
                                    repeats:YES];
}

#pragma mark - Boss key

- (void)bossHide:(id)sender {
    if (!self.shown) return;
    [self.webView evaluateJavaScript:kPauseJS completionHandler:nil];
    [self.window orderOut:nil];
    if (NSApp.isActive) [NSApp hide:nil];  // hand focus back to the previous app
    self.shown = NO;
    emit(@"visible 0");
}

- (void)bossShow {
    if (self.shown) return;
    [NSApp unhideWithoutActivation];
    [self.window orderFrontRegardless];  // show without stealing focus from VS Code
    self.shown = YES;
    emit(@"visible 1");
}

#pragma mark - Line protocol

- (void)listenOnStdin {
    self.inBuf = [NSMutableString new];
    __weak AppDelegate *weakSelf = self;
    [NSFileHandle fileHandleWithStandardInput].readabilityHandler = ^(NSFileHandle *h) {
        NSData *d = h.availableData;
        if (d.length == 0) {  // parent went away
            h.readabilityHandler = nil;
            dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
            return;
        }
        NSString *s = [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] ?: @"";
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf feed:s]; });
    };
}

- (void)feed:(NSString *)chunk {
    [self.inBuf appendString:chunk];
    NSRange nl;
    while ((nl = [self.inBuf rangeOfString:@"\n"]).location != NSNotFound) {
        NSString *cmd = [[self.inBuf substringToIndex:nl.location]
            stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
        [self.inBuf deleteCharactersInRange:NSMakeRange(0, nl.location + 1)];
        if ([cmd isEqualToString:@"hide"]) [self bossHide:nil];
        else if ([cmd isEqualToString:@"show"]) [self bossShow];
        else if ([cmd isEqualToString:@"toggle"]) { if (self.shown) [self bossHide:nil]; else [self bossShow]; }
        else if ([cmd isEqualToString:@"quit"]) [NSApp terminate:nil];
    }
}

- (void)tick {
    if (!self.shown || self.window.isMiniaturized) {
        emit(@"tick 0 -");
        return;
    }
    [self.webView evaluateJavaScript:kStatusJS completionHandler:^(id result, NSError *err) {
        NSString *r = [result isKindOfClass:[NSString class]] ? result : @"0|";
        NSArray *parts = [r componentsSeparatedByString:@"|"];
        NSString *playing = parts.count > 0 ? parts[0] : @"0";
        NSString *key = parts.count > 1 && [parts[1] length] ? parts[1] : @"-";
        emit([NSString stringWithFormat:@"tick %@ %@", playing, key]);
    }];
}

#pragma mark - WebKit / app

// Open target=_blank links in the same view.
- (WKWebView *)webView:(WKWebView *)w
    createWebViewWithConfiguration:(WKWebViewConfiguration *)c
               forNavigationAction:(WKNavigationAction *)action
                    windowFeatures:(WKWindowFeatures *)features {
    if (!action.targetFrame) [w loadRequest:action.request];
    return nil;
}

// Quit only when the user actually closes the window, not when the boss key hides it.
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {
    return NO;
}

- (void)windowWillClose:(NSNotification *)note {
    [NSApp terminate:nil];
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN);
        NSApplication *app = [NSApplication sharedApplication];
        AppDelegate *delegate = [AppDelegate new];
        delegate.args = [[NSProcessInfo processInfo] arguments];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];

        // Minimal menu: Cmd+H = boss key (pause + hide), Cmd+Q, and editing keys.
        NSMenu *mainMenu = [NSMenu new];
        NSMenuItem *appItem = [NSMenuItem new];
        [mainMenu addItem:appItem];
        NSMenu *appMenu = [NSMenu new];
        [appMenu addItemWithTitle:@"Hide Sidereel (Boss Key)" action:@selector(bossHide:) keyEquivalent:@"h"];
        [appMenu addItem:[NSMenuItem separatorItem]];
        [appMenu addItemWithTitle:@"Quit Sidereel" action:@selector(terminate:) keyEquivalent:@"q"];
        appItem.submenu = appMenu;
        NSMenuItem *editItem = [NSMenuItem new];
        [mainMenu addItem:editItem];
        NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
        [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
        [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
        [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
        editItem.submenu = editMenu;
        app.mainMenu = mainMenu;

        [app run];
    }
    return 0;
}
