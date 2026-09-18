pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                deleteDir()
                checkout scm
                script {
                    if (isUnix()) {
                        sh 'echo "Checked out commit: $(git rev-parse --short HEAD)"'
                    } else {
                        bat 'for /f "delims=" %%i in (\'git rev-parse --short HEAD\') do echo Checked out commit: %%i'
                    }
                }
            }
        }

        stage('Environment Setup') {
            steps {
                echo "Setting up environment..."
                script {
                    if (isUnix()) {
                        sh 'node --version || echo "Node not found"'
                        sh 'npm --version || echo "NPM not found"'
                        sh 'docker --version || echo "Docker not found"'
                        sh 'docker-compose --version || echo "Docker Compose not found"'
                    } else {
                        bat 'node --version || echo "Node not found"'
                        bat 'npm --version || echo "NPM not found"'
                        bat 'docker --version || echo "Docker not found"'
                        bat 'docker-compose --version || echo "Docker Compose not found"'
                    }
                }
            }
        }
        
        stage('Install Backend Dependencies') {
            steps {
                dir('backend') {
                    // Using sh for bash/linux agents. If this runs on windows, it might need 'bat' instead.
                    // We'll use a try-catch pattern or generic commands to be safe.
                    script {
                        try {
                            if (isUnix()) {
                                sh 'npm install'
                            } else {
                                bat 'npm install'
                            }
                        } catch (Exception e) {
                            echo "Skipping or failed backend npm install: ${e.message}"
                        }
                    }
                }
            }
        }
        
        stage('Install Frontend Dependencies') {
            steps {
                dir('frontend') {
                    script {
                        try {
                            if (isUnix()) {
                                sh 'npm install'
                            } else {
                                bat 'npm install'
                            }
                        } catch (Exception e) {
                            echo "Skipping or failed frontend npm install: ${e.message}"
                        }
                    }
                }
            }
        }
        
        stage('Deploy to Server') {
            steps {
                script {
                    echo "Deploying application using Docker Compose..."
                    if (isUnix()) {
                        sh 'cp deploy/local.env backend/.env'
                        sh 'docker-compose down --remove-orphans || true'
                        sh 'docker rm -f hms-backend hms-frontend || true'
                        sh 'docker-compose build --no-cache backend frontend'
                        sh 'docker-compose up -d'
                        sh 'docker-compose ps'
                        sh 'docker inspect --format="{{.Name}} {{.Image}}" hms-backend hms-frontend || true'
                    } else {
                        bat 'copy deploy\\local.env backend\\.env'
                        bat 'docker-compose down --remove-orphans || exit /b 0'
                        bat 'docker rm -f hms-backend hms-frontend || exit /b 0'
                        bat 'docker-compose build --no-cache backend frontend'
                        bat 'docker-compose up -d'
                        bat 'docker-compose ps'
                        bat 'docker inspect --format="{{.Name}} {{.Image}}" hms-backend hms-frontend || exit /b 0'
                    }
                }
            }
        }
    }

    post {
        always {
            echo "Pipeline finished!"
        }
        success {
            echo "Pipeline completed successfully."
        }
        failure {
            echo "Pipeline failed. Check logs for details."
        }
    }
}
