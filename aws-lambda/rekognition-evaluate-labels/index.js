exports.handler = (event, context, callback) => {
    
    //
    // Evaluates labels from Rekognition and decides whether or not an emergency situation has been detected.
    //
    
    try {
    
        var labels = event.Labels;
        var key = 'Name';
      
        // List should be extended with all "trigger" labels from Rekognition
        for (key in labels) {
          if (labels.hasOwnProperty(key)) {
            if (labels[key].Name.indexOf('Human') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('People') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Person') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Male') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Female') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Apparel') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Clothing') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Selfie') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Costume') > -1) callback(null, Object.assign({"Alert": "true"}, event));
            if (labels[key].Name.indexOf('Portrait') > -1) callback(null, Object.assign({"Alert": "true"}, event));
          }
        }
    
    }
    catch(err) {
        
        // Log errors
        var errorMessage =  'Error in [rekognition-evaluate-labels].\r' + 
                                '   Function input ['+JSON.stringify(event, null, 2)+'].\r' +  
                                '   Error ['+err+'].';
        console.log(errorMessage);
        
        callback(err, null);
        
    }
        
    // If we get this far then no 'alert' label was found        
    callback(null, Object.assign({"Alert": "false"}, event));
};
