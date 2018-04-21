# skill.json

The skill.json file in the aws-ask folder defines the Alexa skill that the user interacts with to control ZoneMinder.

## Contents

1. **skill.json** - json that defines the Alexa skill.

## How to use

### Alexa Skills Kit Developer Console

Using the [Alexa Skills Kit Developer Console](https://developer.amazon.com/alexa/console/ask?) create a new custom skill called smart-zoneminder. Note the ARN of the skill, you'll need to add this to the creds.json file of the AMS Lambda function intent handler. 

### Upload json

Paste the contents of skill.json into the json editor in the build menu of the custom skill. Edit the intents and slots to suit your configuration. If you change the name of an intent or add one make sure you make the corresponding changes in  the Lambda intent handler. 

### Save and Build Model
Select save and then build the model. 