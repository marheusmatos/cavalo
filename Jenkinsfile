pipeline {
    agent any

    environment {
        IMAGE_NAME     = 'editaraqui'
        CONTAINER_NAME = 'editaraqui'
        HOST_PORT      = '5400'
        CONTAINER_PORT = '8000'
        DATA_DIR       = '/var/lib/jenkins/editaraqui'
        BASE_PATH      = '/pmo/editaraqui'
    }

    stages {
        stage('Build') {
            steps {
                sh 'docker build -t $IMAGE_NAME .'
            }
        }

        stage('Deploy') {
            steps {
                withCredentials([
                    file(credentialsId: 'editaraqui-credentials', variable: 'CREDENCIAIS')
                ]) {
                    sh '''
                        set -e

                        # Garante que o diretório exista
                        mkdir -p "$DATA_DIR"

                        # Atualiza a credencial
                        install -m 0640 "$CREDENCIAIS" "$DATA_DIR/credenciais.json"

                        # Remove o container anterior, se existir
                        docker stop "$CONTAINER_NAME" || true
                        docker rm "$CONTAINER_NAME" || true

                        # Sobe o novo container
                        docker run -d \
                            -p 127.0.0.1:$HOST_PORT:$CONTAINER_PORT \
                            -v "$DATA_DIR":/app/data \
                            -e PMO_BASE_PATH="$BASE_PATH" \
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
            echo 'Deploy falhou — verifique a credencial editaraqui-credentials e o DATA_DIR.'
        }

        success {
            echo 'Deploy concluído com sucesso.'
        }
    }
}