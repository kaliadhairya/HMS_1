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
                    // The release script keeps the data: backup, migrate, replace containers one by
                    // one, health check, automatic rollback (OPERATIONS.md section 10).
                    if (!isUnix()) { error('Releases run on the Linux host (scripts/release.sh).') }
                    sh 'bash scripts/release.sh docker-compose.prod.yml'
                    sh 'docker compose -f docker-compose.prod.yml ps'
                }
            }
        }

        stage('Smoke & Health Verification') {
            steps {
                echo "Waiting for services to report healthy..."
                script {
                    sh 'curl -skf https://127.0.0.1/api/ready'
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
