define('xstyle/core/base', [
	'xstyle/core/elemental',
	'xstyle/core/expression',
	'xstyle/core/Definition',
	'xstyle/core/utils',
	'put-selector/put',
	'xstyle/core/Rule',
	'dojo/Deferred'
], function(elemental, expression, Definition, utils, put, Rule, Deferred){
	// this module defines the base definitions intrisincally available in xstyle stylesheets
	var testDiv = put('div');
	var ua = navigator.userAgent;
	var vendorPrefix = ua.indexOf('WebKit') > -1 ? '-webkit-' :
		ua.indexOf('Firefox') > -1 ? '-moz-' :
		ua.indexOf('MSIE') > -1 ? '-ms-' :
		ua.indexOf('Opera') > -1 ? '-o-' : '';
	// we treat the stylesheet as a 'root' rule; all normal rules are children of it
	var currentEvent;
	var root = new Rule();
	var matchesRule = elemental.matchesRule;
	root.root = true;
	function elementProperty(property, rule, inherit, newElement){
		// definition bound to an element's property
		var definition = new Definition(function(){
			return {
				forElement: function(element){
					var contentElement = element;
					if(newElement){
						// content needs to start at the parent
						element = element.parentNode;
					}
					if(rule && rule.selector){
						while(!matchesRule(element, rule)){
							element = element.parentNode;
							if(!element){
								throw new Error('Rule not found');
							}
						}
					}
					if(inherit){
						// we find the parent element with an item property, and key off of that 
						while(!(property in element)){
							element = element.parentNode;
							if(!element){
								throw new Error(property ? (property + ' not found') : ('Property was never defined'));
							}
						}
					}
					// provide a means for being able to reference the target node,
					// this primarily used by the generate model to nest content properly
					if(newElement){
						element['_' + property + 'Node'] = contentElement;
					}
					var value = element[property];
					if(!value){
						return getVarDefinition(property).valueOf().forRule(rule);
					}
					return value;
				}						
			};
		});
		definition.define = function(rule, newProperty){
			// if we don't already have a property define, we will do so now
			return elementProperty(property || newProperty, rule, newElement);
		};
		definition.forRule = function(rule){
			return elementProperty(property, rule, newElement);			
		};
		definition.put = inherit ? function(value, rule){
			return getVarDefinition(property).put(value, rule, property);
		} :
		function(value){
			// TODO: we may want to have forRule for define so that this can
			// be inherited
			// for plain element-property, we set the value on the element
			return {
				forElement: function(element){
					if(rule && rule.selector){
						while(!matchesRule(element, rule)){
							element = element.parentNode;
							if(!element){
								throw new Error('Rule not found');
							}
						}
					}
					element[property] = value;
					definition.invalidate({elements: [element]});
				}
			};
		};
		return definition;
	}
	function observeExpressionForRule(rule, name, value, callback){
		return utils.when(expression.evaluate(rule, value), function(result){
			if(result.forElement){
				// we can't just set a style, we need to individually apply
				// the styles for each element
				elemental.addRenderer(rule, function(element){
					callback(result.forElement(element), element);
				});
			}else{
				callback(result);
			}
		});
	}
	function conditional(yes, no){
		return {
			apply: function(rule, args, name){
				observeExpressionForRule(rule, name, args[0], function(observable, element){
					observable.observe(function(variableValue){
						// convert to the conditional values
						variableValue = variableValue ? yes : no;
						var resolved = value.toString().replace(new RegExp(yes + '\\([^)]+\\)', 'g'), variableValue);
						if(element){
							element.style[name] = variableValue;
						}else{
							rule.setStyle(name, variableValue);
						}
					});
				});
			}
		};
	}
	var variableDefinitions = {};
	function getVarValueForParent(rule, name){
		var variables = rule.variables;
		if(variables && name in variables){
			return variables[name];
		}
		var bases = rule.bases;
		if(bases){
			for(var i = 0; i < bases.length; i++){
				var result = getVarValueForParent(bases[i], name);
				if(result !== undefined){
					return result;
				}
			}
		}
	}
	function getVarValue(rule, name){
		do{
			var value = getVarValueForParent(rule, name);
			if(value !== undefined){
				return value;
			}
			rule = rule.parent;
		}while(rule);
	}
	function getVarDefinition(name){
		var variableDefinition = variableDefinitions[name];
		if(!variableDefinition){
			variableDefinition = variableDefinitions[name] = new Definition(function(){
				return {
					forRule: function(rule){
						return getVarValue(rule, name);
					}
				};
			});
			variableDefinition.put = function(value, declaringRule, name){
				// assignment to a var
				return {
					forRule: function(rule){
						(rule.variables || (rule.variables = {}))[name] = value;
						var affectedRules = [];
						function addDerivatives(rule){
							affectedRules.push(rule);
							for(var name in rule.rules){
								addDerivatives(rule.rules[name]);
							}
						}
						while(rule){
							addDerivatives(rule);
							rule = rule.parent;
						}
						variableDefinition.invalidate({rules: affectedRules});
					}
				};
			};
		}
		return variableDefinition;
	}
	// the root has it's own intrinsic variables that provide important base and bootstrapping functionality 
	root.definitions = {
		// useful globals to import
		Math: Math,
		window: window,
		global: window,
		module: expression.selfResolving(function(mid, lazy){
			// require calls can be used to load in data in
			if(mid[0].value){
				// support mid as a string literal as well
				mid = mid[0].value;
			}
			if(!lazy){
				require([mid]);
			}
			return {
				then: function(callback){
					var deferred = new Deferred();
					require([mid], function(module){
						deferred.resolve(callback(module));
					});
					return deferred.promise;
				}
			};
		}),
		// TODO: add url()
		// adds support for referencing each item in a list of items when rendering arrays 
		item: elementProperty('item', null, true),
		pageContent: new Definition(),
		// adds referencing to the prior contents of an element
		content: elementProperty('content', null, true, function(){
			this.element;
		}),
		// don't define the property now let it be redefined when it is declared in another
		// definition
		elementProperty: elementProperty(),
		element: {
			// definition to reference the actual element
			forElement: function(element){
				return element;
			},
			define: function(rule){
				// if it is defined, then we go from the definition
				return {
					forElement: function(element){
						while(!matchesRule(element, rule)){
							element = element.parentNode;
							if(!element){
								throw new Error('Rule not found');
							}
						}
						return element;
					}
				};
			}
		},
		event: {
			observe: function(callback){
				callback(currentEvent);
			},
			valueOf: function(){
				return currentEvent;
			}
		},
		each: {
			put: function(value){
				return {
					forRule: function(rule){
						rule.each = value;
					}
				};
			}
		},
		prefix: {
			put: function(value, declaringRule, name){
				// add a vendor prefix
				// check to see if the browser supports this feature through vendor prefixing
				return {
					forRule: function(rule){
						if(typeof testDiv.style[vendorPrefix + name] == 'string'){
							// if so, handle the prefixing right here
							rule._setStyleFromValue(vendorPrefix + name, value);
							return true;
						}
					}							
				};
			}
		},
		// provides CSS variable support
		'var': {
			define: function(rule, name){
				return getVarDefinition(name);
			},
			selfResolving: true,
			apply: function(definition, args){
				// var(property) call
				return getVarDefinition(utils.convertCssNameToJs(args[0]));
			}
		},
		inline: conditional('inline', 'none'),
		block: conditional('block', 'none'),
		visible: conditional('visible', 'hidden'),
		'extends': {
			apply: function(rule, args){
				// TODO: this is duplicated in the parser, should consolidate
				for(var i = 0; i < args.length; i++){ // TODO: merge possible promises
					return utils.extend(rule, args[i], console.error);
				}
			}
		},
		set: {
			selfExecuting: true,
			apply: function(target, args){
				return args[0].put(args[1].valueOf());
			}
		},
		get: function(value){
			return value;
		},
		toggle: {
			selfExecuting: true,
			apply: function(target, args){
				return args[0].put(!args[0].valueOf());
			}
		},
		on: {
			put: function(value, declaringRule, name){
				// add listener
				return {
					forRule: function(rule){
						elemental.on(document, name.charAt(2).toLowerCase() + name.slice(3), rule, function(event){
							currentEvent = event;
							// execute the event listener by calling valueOf
							// note that we could define a flag on the definition to indicate that
							// we shouldn't cache it, incidently, since their are no dependencies
							// declared for this definition, it shouldn't end up being cached
							try{
								utils.when(expression.evaluate(rule, value).valueOf(), function(result){
									if(result && result.forRule){
										result = result.forRule(rule);
									}
									if(result && result.forElement){
										result = result.forElement(event.target);
									}
									currentEvent = null;
								});
							}catch(e){
								console.error('Error in ' + name + ' event handler, executing ' + value, e);
							}
						});
					}
				};
			}
		},
		title: {
			put: function(value){
				return {
					forRule: function(rule){
						expression.observe(expression.evaluate(rule, value), function(value){
							document.title = value;	
						});
					}
				};
			}
		},
		'@supports': {
			selector: function(rule){
				function evaluateSupport(expression){
					var parsed;
					if(parsed = expression.match(/^\s*not(.*)/)){
						return !evaluateSupport(parsed[1]);
					}
					if(parsed = expression.match(/\((.*)\)/)){
						return evaluateSupport(parsed[1]);
					}
					if(parsed = expression.match(/([^:]*):(.*)/)){
						// test for support for a property
						var name = utils.convertCssNameToJs(parsed[1]);
						var value = testDiv.style[name] = parsed[2];
						return testDiv.style[name] == value;
					}
					if(parsed = expression.match(/\w+\[(.*)=(.*)\]/)){
						// test for attribute support
						return put(parsed[0])[parsed[1]] == parsed[2];
					}
					if(parsed = expression.match(/\w+/)){
						// test for attribute support
						return utils.isTagSupported(parsed);
					}
					throw new Error('can\'t parse @supports string');
				}
				
				if(evaluateSupport(rule.selector.slice(10))){
					rule.selector = '';
				}else{
					rule.disabled = true;
				}
			}
		},
		// the primitives
		'true': true,
		'false': false,
		'null': null
	};
	root.elementProperty = elementProperty;
	return root;
});