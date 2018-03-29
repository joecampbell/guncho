﻿'use strict';

module guncho.directives.tooltipToggle {
    // http://stackoverflow.com/questions/20939754/good-way-to-dynamically-open-close-a-popover-or-tooltip-using-angular-based

    export interface DirectiveSettings {
        directiveName: string;
        directive: any[];
        directiveConfig?: any[];
    }

    export function directiveSettings(tooltipOrPopover = 'tooltip'): DirectiveSettings {

        var directiveName = tooltipOrPopover;

        // events to handle show & hide of the tooltip or popover
        var showEvent = 'show-' + directiveName;
        var hideEvent = 'hide-' + directiveName;

        // set up custom triggers
        var directiveConfig = ['$tooltipProvider', ($tooltipProvider: ng.ui.bootstrap.ITooltipProvider): void => {
            var trigger: { [index: string]: string; } = {};
            trigger[showEvent] = hideEvent;
            $tooltipProvider.setTriggers(trigger);
        }];

        var directiveFactory = (): any[]=> {
            return ['$timeout', ($timeout: ng.ITimeoutService): ng.IDirective => {
                var d: ng.IDirective = {
                    name: directiveName,
                    restrict: 'A',
                    link: (scope: ng.IScope, element: JQuery, attr: ng.IAttributes) => {

                        if (angular.isUndefined(attr[directiveName + 'Toggle'])) return;

                        // set the trigger to the custom show trigger
                        attr[directiveName + 'Trigger'] = showEvent;

                        // redraw the popover when responsive UI moves its source
                        var redrawPromise: ng.IPromise<void>;
                        $(window).on('resize', (): void => {
                            if (redrawPromise) $timeout.cancel(redrawPromise);
                            redrawPromise = $timeout((): void => {
                                if (!scope['tt_isOpen']) return;
                                element.triggerHandler(hideEvent);
                                element.triggerHandler(showEvent);

                            }, 100);
                        });

                        scope.$watch(attr[directiveName + 'Toggle'], (value: boolean): void => {
                            if (value && !scope['tt_isOpen']) {
                                // tooltip provider will call scope.$apply, so need to get out of this digest cycle first
                                $timeout((): void => {
                                    element.triggerHandler(showEvent);
                                });
                            }
                            else if (!value && scope['tt_isOpen']) {
                                $timeout((): void => {
                                    element.triggerHandler(hideEvent);
                                });
                            }
                        });
                    }
                };
                return d;
            }];
        };

        var directive = directiveFactory();

        var directiveSettings: DirectiveSettings = {
            directiveName: directiveName,
            directive: directive,
            directiveConfig: directiveConfig,
        };

        return directiveSettings;
    }
}

(function () {
    var tooltipToggle = guncho.directives.tooltipToggle.directiveSettings();
    var popoverToggle = guncho.directives.tooltipToggle.directiveSettings('popover');

    app.directive(tooltipToggle.directiveName, tooltipToggle.directive).config(tooltipToggle.directiveConfig);
    app.directive(popoverToggle.directiveName, popoverToggle.directive).config(popoverToggle.directiveConfig);
})();
