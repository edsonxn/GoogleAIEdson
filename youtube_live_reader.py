#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para leer comentarios en tiempo real de YouTube Live usando pytchat
"""

import sys
import json
import time
from datetime import datetime

def read_youtube_live_comments(video_id, max_comments=50, timeout=30):
    """
    Lee comentarios en vivo de YouTube usando pytchat
    
    Args:
        video_id (str): ID del video de YouTube
        max_comments (int): Máximo número de comentarios a leer
        timeout (int): Tiempo máximo en segundos para leer comentarios
        
    Returns:
        dict: Resultado con comentarios encontrados
    """
    try:
        from pytchat import create

        print(f"🎬 Conectando a pytchat para video: {video_id}", file=sys.stderr)

        # Crear instancia de Chat
        chat = create(video_id=video_id)
        comments = []
        comment_count = 0
        start_time = time.time()
        
        print(f"📺 Leyendo comentarios del live...", file=sys.stderr)

        while chat.is_alive():
            # Verificar timeout
            if time.time() - start_time > timeout:
                print(f"⏱️ Timeout alcanzado ({timeout}s)", file=sys.stderr)
                break

            # Verificar límite de comentarios
            if comment_count >= max_comments:
                print(f"📊 Límite de comentarios alcanzado ({max_comments})", file=sys.stderr)
                break
                
            for message in chat.get().sync_items():
                if comment_count >= max_comments:
                    break

                try:
                    author = message.author.name or "Anónimo"
                    text = message.message or ""
                    timestamp = datetime.now().strftime("%H:%M:%S")

                    comment = {
                        "author": author,
                        "text": text,
                        "timestamp": timestamp,
                        "superchat": getattr(message, 'amountString', False) if getattr(message, 'amountValue', 0) > 0 else False
                    }

                    comments.append(comment)
                    comment_count += 1
                    
                    # Emitir JSON por stdout para que Node.js lo mande al WebSocket
                    ws_msg = {
                        "type": "comment",
                        "author": author,
                        "text": text,
                        "timestamp": timestamp
                    }
                    import json
                    print(f"---COMMENT---{json.dumps(ws_msg)}", flush=True)

                    print(f"💬 [{timestamp}] {author}: {text[:50]}...", file=sys.stderr)

                except Exception as e:
                    print(f"⚠️ Error procesando mensaje: {str(e)}", file=sys.stderr)
                    continue

            time.sleep(1) # Pequeña pausa para no saturar CPU en el loop

        # Cerrar chat
        try:
            chat.terminate()
        except:
            pass
        
        result = {
            "success": True,
            "videoId": video_id,
            "totalComments": len(comments),
            "comments": comments,
            "timestamp": datetime.now().isoformat()
        }
        
        return result
        
    except ImportError:
        print("❌ Error: pytchat no está instalado", file=sys.stderr)
        return {
            "success": False,
            "error": "pytchat no está instalado. Ejecuta: pip install pytchat"
        }
    except Exception as e:
        print(f"❌ Error leyendo comentarios: {str(e)}", file=sys.stderr)
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """Función principal para CLI"""
    if len(sys.argv) < 2:
        print("Uso: python youtube_live_reader.py <video_id> [max_comments] [timeout]")
        sys.exit(1)
    
    video_id = sys.argv[1]
    max_comments = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    
    result = read_youtube_live_comments(video_id, max_comments, timeout)
    
    # Imprimir resultado como JSON en stdout
    print("---JSON_START---")
    print(json.dumps(result, ensure_ascii=False))
    print("---JSON_END---")

if __name__ == "__main__":
    main()
