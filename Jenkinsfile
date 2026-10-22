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
                    // Owner's choice (2026-10-22): deploy the development stack as before, with a
                    // database backup first. Secure production releases use scripts/release.sh.
                    if (!isUnix()) { error('Deploys run on the Linux host.') }
                    // The app's secrets live on this machine, never in git: $JENKINS_HOME/hms.env
                    // (a copy of the project's .env) becomes the build's .env.
                    sh '''
                        if [ -f "$JENKINS_HOME/hms.env" ]; then
                          cp "$JENKINS_HOME/hms.env" .env
                        elif [ -z "$JWT_SECRET" ]; then
                          echo "Missing $JENKINS_HOME/hms.env - copy the project's .env there (see README)."
                          exit 1
                        fi
                    '''
                    sh '''
                        if docker ps --format '{{.Names}}' | grep -qx hms-db; then
                          bash scripts/backup-db.sh docker-compose.yml
                        else
                          echo "No running database yet: nothing to back up."
                        fi
                    '''
                    sh 'docker rm -f hms-backend hms-frontend hms-prometheus hms-grafana 2>/dev/null || true'
                    sh 'docker compose up -d --build'
                    sh 'docker compose ps'
                }
            }
        }

        stage('Smoke & Health Verification') {
            steps {
                echo "Waiting for services to report healthy..."
                script {
                    sh 'for i in $(seq 1 30); do curl -sf http://localhost:5001/api/ready && break; sleep 3; done'
                    sh 'curl -sf http://localhost:5001/api/ready'
                    sh 'curl -sf http://localhost:4999 >/dev/null'
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
