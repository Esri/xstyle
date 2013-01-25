define(['dbind/bind', 'xstyle/util/create-style-sheet', 'xstyle/elemental'], function(bind, createStyleSheet, elemental){
	var model = {
		data: '{\n  "first": "Web",\n  "last": "Developer",\n  "favorites": [\n    "Data Bindings", "CSS Extensions"\n  ]\n}', 
		ui: "#target {\n => h2 {\n      innerHTML = data.first+' '+data.last;\n    },\n    ul {\n      from: data.favorites;\neach:span {from:item[0];};    };\n  background-color: red;\n  width: 100px;\n  height: 100px;\n}", 
		parsed: {}};
	var converter = bind(model);
	converter.get('data', update);
	converter.get('ui', update);
	var parse, lastStyleSheet;
	function update(){
		console.log('model.data, model.ui', model.data, model.ui);
		var newSheet = createStyleSheet(model.ui);
		try{
			converter.get('parsed').put(JSON.parse(model.data));
			converter.get('data').get('error').put('');
		}catch(e){
			converter.get('data').get('error').put(e);
		}
		setTimeout(function(){
			if(lastStyleSheet){
				// remove the last stylesheet
				document.head.removeChild(lastStyleSheet);
				elemental.clearRenderers();
				var target = document.getElementById("target");
				if(target){
					target.innerHTML = "";
				}
			}
			
			lastStyleSheet = newSheet;
			try{
				parse(model.ui, lastStyleSheet.sheet);
				converter.get('ui').get('error').put('');
			}catch(e){
				converter.get('ui').get('error').put(e);
			}
		},100);
	}
	converter.onProperty = function(name, value, rule){
		do{
			parse = rule.parse;
			rule = rule.parent;
		}while(!parse);
	}	return converter;
});