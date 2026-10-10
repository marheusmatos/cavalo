pipeline {
    agent any

    environment {
        IMAGE_NAME     = 'cavalo'
        CONTAINER_NAME = 'cavalo'
        HOST_PORT      = '5400'
        CONTAINER_PORT = '8000'
        DATA_DIR       = '/var/lib/jenkins/cavalo'
        BASE_PATH      = '/cavalo'
    }

    stages {
        stage('Build') {
            steps {
                sh 'docker build -t $IMAGE_NAME .'
            }
        }

        stage('Deploy') {
            steps {
                     {
                    sh '''
                        set -e

                        # Garante que o diretório exista
                        mkdir -p "$DATA_DIR"

                        # Remove o container anterior, se existir
                        docker stop "$CONTAINER_NAME" || true
                        docker rm "$CONTAINER_NAME" || true

                        # Sobe o novo container
                        docker run -d \
                            -p 127.0.0.1:$HOST_PORT:$CONTAINER_PORT \
                            -v "$DATA_DIR":/app/data \
                            --name "$CONTAINER_NAME" \
                            --restart unless-stopped \
                            "$IMAGE_NAME"
                    '''
                }
            }
        }
    }

    post {
        failure {
            echo 'Deploy falhou'
        }

        success {
            echo 'Deploy concluído com sucesso.'
        }
    }
}