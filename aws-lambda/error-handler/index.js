exports.handler = (event, context, callback) => {

  // Pickup parameters from calling event
  var errorMessage = JSON.stringify(event, null, 2);

  console.log(errorMessage);
  
  //var error = new Error(event.input);
  
  var exitErrMsg = 'something bad happened - check console log';
  
  var errObj = new Error(exitErrMsg);
  
  callback(errObj, null);

};
