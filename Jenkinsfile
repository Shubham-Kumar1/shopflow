pipeline {
    agent any

    tools {
        sonarQube 'sonar-scanner'
    }

    stages {

        stage('Checkout Code') {
            steps {
                git 'https://github.com/Shubham-Kumar1/shopflow.git'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('sonarqube-server') {
                    sh '''
                    sonar-scanner \
                    -Dsonar.projectKey=shopflow \
                    -Dsonar.sources=. \
                    -Dsonar.host.url=http://34.180.25.168:9000 \
                    -Dsonar.login=$SONAR_AUTH_TOKEN
                    '''
                }
            }
        }

    }
}
