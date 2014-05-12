define('xstyle/core/expression', ['xstyle/core/utils'], function(utils){
	// handles the creation of reactive expressions
	var nextId = 1;
	function get(target, path){
		return utils.when(target, contextualize(function(target){
			var name = path[0];
			if(!target){
				return target;
			}
			if(name && target.property){
				return get(target.property(name), path.slice(1));
			}
			if(name){
				return get(target[name], path.slice(1));
			}
			return target;
		}));
	}
	function observe(target, callback){
		return (target && target.observe) ? target.observe(callback) : callback(target);
	}
	function contextualize(callback){
		return function(target){
			if(target && target.forElement){
				return {
					forElement: function(element){
						return callback(target.forElement(element));
					}
				};
			}
			return callback(target);
		}
	}
	function set(target, path, value){
		get(target, path.slice(0, path.length - 1), function(target){
			var property = path[path.length - 1];
			target.set ?
				target.set(property, value) :
				target[property] = value;
		});
	}
	function someHasProperty(array, property){
		for(var i = 0, l = array.length; i < l; i++){
			var item = array[i];
			if(item && typeof item == 'object' && property in item){
				return true;
			}
		}
	}
	function resolved(callback, returnArray){
		function resolve(){
			var args = arguments;
			var resolved;
			if(resolve.skipResolve){
				resolved = args;
			}else{
				resolved = [];
				for(var i = 0, l = args.length; i < l; i++){
					resolved[i] = evaluateExpression(this, args[i]);
				}
			}
			return callback[returnArray ? 'call' : 'apply'](this, resolved);
		};
		return resolve;
	}

	function ready(callback, returnArray){
		return resolved(function(inputs){	
			// handles waiting for async inputs
			if(someHasProperty(inputs, 'then')){
				var inputs = inputs;
				// we have asynch inputs, do lazy loading
				return {
					then: function(onResolve, onError){
						var remaining = 1;
						var readyInputs = [];
						for(var i = 0; i < l; i++){
							var input = inputs[i];
							if(input && input.then){
								remaining++;
								(function(i){
									input.then(function(value){
										readyInputs[i] = value;
										onEach();
									}, onError);
								})(i);
							}else{
								readyInputs[i] = input;
								onEach();
							}
						}
						onEach();
						function onEach(){
							remaining--;
							if(!remaining){
								onResolve(callback[returnArray ? 'call' : 'apply'](this, readyInputs));
							}
						}
					}
				};
			}
			// just sync inputs
			return callback[returnArray ? 'call' : 'apply'](this, inputs);
		}, true);
	}
	function contextualized(callback, returnArray){
		// this function is responsible for contextualizing a result
		// based on the context of the arguments/inputs
		return ready(function(inputs){
			inputs.id = nextId++;
			var isElementDependent;
			// TODO: eventually we probably want to abstract out contextualization
			if(someHasProperty(inputs, 'forElement')){
				return {
					forElement: function(element){
						var mostSpecificElement;
						// now find the element that matches that rule, in case we are dealing with a child
						var parentElement;
						var outputs = [];
						for(var i = 0, l = inputs.length; i < l; i++){
							var input = inputs[i];
							// now find the element that is keyed on
							if(input && input.forElement){
								input = input.forElement(element, input.length == 1);
							}
							outputs[i] = input;
							// we need to find the most parent element that we need to vary on for this computation 
							var varyOnElement = parentElement = input.element;
							if(mostSpecificElement){
								// check to see if one its parent is the mostSpecificElement
								while(parentElement && parentElement != mostSpecificElement){
									parentElement = parentElement.parentNode;
								}
								// if so, we have a new most specific
							}
							if(parentElement){
								mostSpecificElement = varyOnElement;
							}
						}
						// make sure we indicate the store we are keying off of
						var computation = mostSpecificElement['expr-result-' + inputs.id];
						if(!computation){
							mostSpecificElement['expr-result-' + inputs.id] = computation = callback[returnArray ? 'call' : 'apply'](this, outputs);
							computation && (computation.element = mostSpecificElement);
						}
						return computation;
					}
				};
			}
			return callback[returnArray ? 'call' : 'apply'](this, inputs);
		}, true);
	}
	function react(callback, reverse){
		// based on reactive inputs, define a new reactive,
		// that uses the callback function to compute new values
		return contextualized(function(inputs){
			function computeResult(){
				var values = [];
				for(var i = 0, l = inputs.length; i < l; i++){
					var input = inputs[i];
					values[i] = input && input.valueOf();
				}
				return callback.apply(this, values);
			}
			if(someHasProperty(inputs, 'observe')){
				var result = {
					observe: function(listener){
						for(var i = 0, l = inputs.length; i < l; i++){
							var input = inputs[i];
							input && input.observe && input.observe(function(){
								listener(computeResult());
							});
						}
					},
					valueOf: function(){
						return computeResult();
					}
				};
				if(reverse && someHasProperty(inputs, 'put')){
					result.put = function(value){
						reverse(value, inputs);
					};
				}
				return result;
			}
			return computeResult();
		}, true);
	}
	var deny = {};
	function operator(precedence, forward, reverseA, reverseB){
		// defines the standard operators
		function evaluate(expression){
			return eval('(0||function(a,b){return ' + expression + ';})');
		}
		var forward = evaluate(forward);
		var reverseA = reverseA && evaluate(reverseA);
		var reverseB = reverseB && evaluate(reverseB);
		var operatorReactor = react(forward, function(output, inputs){
			var a = inputs[0],
				b = inputs[1];
			if(a && a.put){
				var result = reverseA(output, b && b.valueOf());
				if(result !== deny){
					a.put(result);
				}
			}else if(b && b.put){
				b.put(reverseB(output, a && a.valueOf()));
			}else{
				throw new TypeError('Can not put');
			}
		});
		operatorReactor.skipResolve = true;
		operatorReactor.precedence = precedence;
		operatorReactor.infix = reverseA === true || !!reverseB;
		return operatorReactor;
	}
	function conditional(){
		return {
			precedence: true,
			infix: true
		}
	}
	var operators = {
		'+': operator(5, 'a+b', 'a-b', 'a-b'),
		'-': operator(5, 'a-b', 'a+b', 'b-a'),
		'*': operator(6, 'a*b', 'a/b', 'a/b'),
		'/': operator(6, 'a/b', 'a*b', 'b/a'),
		'^': operator(7, 'a^b', 'a^(-b)', 'Math.log(a)/Math.log(b)'),
		'?': operator(2, 'b[a?0:1]', 'a===b[0]||(a===b[1]?false:deny)', '[a,b]'),
		':': operator(3, '[a,b]', 'a[0]?a[1]:deny', 'a[1]'),
		'!': operator(8, '!a', '!a')
	};
	function evaluateExpression(rule, value){
		// evaluate an expression
		/*
		// TODO: do we need to cache this?
		var binding = rule['var-expr-' + name];
		if(variables){
			return binding;
		}*/
		value = value.join ? value.slice() : [value];
		for(var i = 0; i < value.length; i++){
			var part = value[i];
			if(typeof part == 'string'){
				// parse out operators
				// TODO: change this to a replace so we can find any extra characters to report
				// a syntax error
				var parts = part.match(/"[^\"]*"|[+-\/\?\:^*!&|]+|[\w_$\.\/-]+/g);
				var spliceArgs = [i, 1];
				if(parts){
					spliceArgs.push.apply(spliceArgs, parts);
				}
				// splice them back into the list
				value.splice.apply(value, spliceArgs);
				// adjust the index
				i += spliceArgs.length - 3;
			}
		}
		var lastOperatorPrecedence;
		var stack = [];
		var lastOperator;
		// now apply operators
		for(var i = 0; i < value.length; i++){
			var part = value[i];
			if(part.operator == '('){
				// TODO: is this being double applied?
				stack.pop();
				part = part.ref.apply(rule, part.args[0].split(','));
			}else if(operators.hasOwnProperty(part)){
				var operator = operators[part];
				windDownStack(operator);
				lastOperatorPrecedence = (lastOperator || operator).precedence;
			}else if(part > -1){
				part = +part;
			}else if(part.isLiteralString){
				part = part.value;
			}else{
				var propertyParts = part.split('/');
				var firstReference = propertyParts[0];
				var target = rule.getDefinition(firstReference);
				if(typeof target == 'string' || target instanceof Array){
					target = evaluateExpression(rule, target);
				}else if(target === undefined){
					throw new Error('Could not find reference "' + firstReference + '"');
				}
				if(propertyParts.length > 1){
					target = get(target, propertyParts.slice(1));
				}
				part = target;
			}
			stack.push(part);
		}
		windDownStack({precedence: 1});
		function windDownStack(operator){
			while(lastOperatorPrecedence >= operator.precedence){
				var lastOperand = stack.pop();
				var executingOperator = operators[stack.pop()];
				var result = executingOperator.apply(rule, executingOperator.infix ? [stack.pop(), lastOperand] : [lastOperand]);
				lastOperator = stack.length && stack[stack.length-1];
				stack.push(result);
				lastOperatorPrecedence = lastOperator && operators[lastOperator] && operators[lastOperator].precedence;
			}
		}

		return stack[0];
	}
	return {
		resolved: resolved,
		ready: ready,
		contextualized: contextualized,
		react: react,
		observe: observe,
		evaluate: evaluateExpression
	};
});
