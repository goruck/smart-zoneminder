# skill.json

The skill.json file in the aws-ask folder defines the Alexa skill that the user interacts with to control ZoneMinder.

## Contents

1. **skill.json** - json that defines the Alexa skill.

## How to use

### Create New Custom Skill

Using the [Alexa Skills Kit Developer Console](https://developer.amazon.com/alexa/console/ask?) create a new custom skill called smart-zoneminder.

Note the ARN of the skill, you'll need to add this to the creds.json file of the AMS Lambda function intent handler. 

### Upload json

Paste the contents of skill.json into the json editor in the build menu of the custom skill.

### Edit Slots

In the build menu of the Alexa Skills Kit Developer Console, edit the Location slot information to suit your configuration.

The Location Slot information and the friendlyNames in the config.json file of the AWS Lambda function intent handler need to be consistent. 

Note: If you change the name of an intent or add one make sure you make the corresponding changes in the Lambda intent handler. 

### Save and Build Model

In the build menu of the Alexa Skills Kit Developer Console, select save and then build the model.

### Add Endpoint

Select Endpoint under the build menus in the Alexa Skills Kit Developer Console and add the ARN of your AWS Lambda function intent handler.

### Test Skill

In the test menu of the Alexa Skills Kit Developer Console, test your skill. 