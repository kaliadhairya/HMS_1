pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    if (isUnix()) {
                        sh 'echo "Checked out commit: $(git rev-parse --short HEAD)"'
                    } else {
                        bat 'git rev-parse --short HEAD'
                    }
                }
            }
        }

        stage('Environment Check') {
            steps {
                echo "Validating Docker & runtime environment..."
                script {
                    if (isUnix()) {
                        sh 'docker --version'
                        sh 'docker compose version || docker-compose --version'
                    } else {
                        bat 'docker --version'
                        bat 'docker compose version || docker-compose --version'
                    }
                }
            }
        }

        stage('Build & Deploy Containers') {
            steps {
                echo "Building and launching HMS containers via Docker Compose..."
                script {
                    if (isUnix()) {
                        sh 'docker rm -f hms-backend hms-frontend hms-db hms-prometheus hms-grafana 2>/dev/null || true'
                        sh 'docker compose up -d --build'
                        sh 'docker compose ps'
                    } else {
                        bat 'docker rm -f hms-backend hms-frontend hms-db hms-prometheus hms-grafana 2>nul || ver >nul'
                        bat 'docker compose up -d --build'
                        bat 'docker compose ps'
                    }
                }
            }
        }

        stage('Smoke & Health Verification') {
            steps {
                echo "Waiting for services to report healthy..."
                script {
                    if (isUnix()) {
                        sh 'sleep 15'
                        sh 'curl -f http://localhost:5001/api/health || exit 1'
                        sh 'curl -f http://localhost:4999 || exit 1'
                    } else {
                        bat 'timeout /t 15 /nobreak'
                        bat 'curl -f http://localhost:5001/api/health'
                        bat 'curl -f http://localhost:4999'
                    }
                }
            }
        }
    }

    post {
        always {
            echo "Jenkins Pipeline execution finished."
        }
        success {
            echo "✓ HMS deployment and health checks passed successfully!"
        }
        failure {
            echo "✗ Deployment failed. Check the Jenkins console logs for details."
        }
    }
}
